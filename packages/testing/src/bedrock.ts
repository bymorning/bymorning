/** Scripted external Bedrock HTTP endpoint, shared by application scenarios. */
export * as TestBedrock from "./bedrock.js"

import { NodeHttpServer } from "@effect/platform-node"
import { Context, Deferred, Effect, Layer, Schema, Stream } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http"
import { createServer } from "node:http"

export interface Step {
  readonly expect: (request: {
    readonly url: string
    readonly headers: Readonly<Record<string, string>>
    readonly body: unknown
  }) => void
  readonly transport: "converse" | "mantle"
  readonly response: "text" | "tool" | "error" | "truncated" | "exception" | "cancel"
}

class ScriptError extends Schema.TaggedError<ScriptError>()("TestBedrock.ScriptError", { cause: Schema.Defect() }) {}

export const make = Effect.fn("TestBedrock.make")(function* () {
  const scripts: { step: Step; done: Deferred.Deferred<void>; gate: Deferred.Deferred<void> }[] = []
  let index = 0
  const failures: unknown[] = []
  const handler = Effect.gen(function* () {
    const incoming = yield* HttpServerRequest.HttpServerRequest
    const script = scripts[index++]
    if (!script) {
      failures.push("Unexpected Bedrock request")
      return HttpServerResponse.empty({ status: 500 })
    }
    const body = yield* incoming.json
    yield* Effect.try({
      try: () =>
        script.step.expect({ url: incoming.headers["x-test-target"] ?? incoming.url, headers: incoming.headers, body }),
      catch: (cause) => new ScriptError({ cause }),
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          failures.push(error)
        }),
      ),
    )
    if (script.step.response === "error") {
      yield* Deferred.succeed(script.done, undefined)
      return HttpServerResponse.jsonUnsafe({ message: "secret upstream diagnostic" }, { status: 403 })
    }
    const events = script.step.transport === "converse" ? converse(script.step.response) : mantle(script.step.response)
    const data = Stream.fromIterable(events).pipe(
      // Split the binary prelude / SSE lines across physical chunks.
      Stream.flatMap((event) => Stream.make(event.slice(0, 7), event.slice(7))),
      Stream.concat(
        script.step.response === "cancel"
          ? Stream.fromEffect(Deferred.succeed(script.gate, undefined).pipe(Effect.andThen(Effect.never)))
          : Stream.empty,
      ),
      Stream.ensuring(Deferred.succeed(script.done, undefined)),
    )
    return HttpServerResponse.stream(data, {
      contentType: script.step.transport === "converse" ? "application/vnd.amazon.eventstream" : "text/event-stream",
    })
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        failures.push(error)
        return HttpServerResponse.empty({ status: 500 })
      }),
    ),
  )
  const context = yield* Layer.build(
    HttpRouter.serve(HttpRouter.add("*", "/*", handler), { disableLogger: true, disableListenLog: true }).pipe(
      Layer.provideMerge(NodeHttpServer.layer(createServer, { host: "127.0.0.1", port: 0 })),
    ),
  )
  const origin = HttpServer.formatAddress(Context.get(context, HttpServer.HttpServer).address)
  const outbound = Layer.effect(
    HttpClient.HttpClient,
    HttpClient.HttpClient.use((client) =>
      Effect.succeed(
        HttpClient.mapRequest(client, (request) => {
          const url = new URL(request.url)
          if (!/^bedrock(?:-runtime(?:-fips)?\.[a-z0-9-]+\.amazonaws\.com|-mantle\.[a-z0-9-]+\.api\.aws)$/.test(url.hostname)) {
            if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return request
            throw new Error(`Unexpected external fixture destination: ${url.hostname}`)
          }
          return HttpClientRequest.setUrl(
            HttpClientRequest.setHeader(request, "x-test-target", request.url),
            `${origin}${url.pathname}`,
          )
        }),
      ),
    ),
  ).pipe(Layer.provide(FetchHttpClient.layer))
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      if (index !== scripts.length || failures.length)
        throw new Error(`Bedrock fixture: ${index}/${scripts.length} requests; ${failures.map(String).join("; ")}`)
    }),
  )
  return {
    outbound,
    expect: Effect.fn("TestBedrock.expect")(function* (step: Step) {
      const done = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      scripts.push({ step, done, gate })
      return { settled: Deferred.await(done), blocked: Deferred.await(gate) }
    }),
    verify: Effect.sync(() => {
      if (failures.length) throw new Error(failures.map(String).join("; "))
    }),
    count: Effect.sync(() => index),
  }
})

const encoder = new TextEncoder()
// Independent wire fixture: AWS eventstream prelude, string headers, payload, and both CRC32 checksums.
const crc = (bytes: Uint8Array) => {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}
const frame = (event: string, payload: unknown, exception = false) => {
  const headers = Object.entries({
    ":message-type": exception ? "exception" : "event",
    [exception ? ":exception-type" : ":event-type"]: event,
    ":content-type": "application/json",
  }).map(([key, value]) => {
    const name = encoder.encode(key),
      text = encoder.encode(value)
    const bytes = new Uint8Array(1 + name.length + 1 + 2 + text.length)
    bytes[0] = name.length
    bytes.set(name, 1)
    bytes[name.length + 1] = 7
    new DataView(bytes.buffer).setUint16(name.length + 2, text.length)
    bytes.set(text, name.length + 4)
    return bytes
  })
  const size = headers.reduce((sum, value) => sum + value.length, 0)
  const body = encoder.encode(JSON.stringify(payload))
  const bytes = new Uint8Array(16 + size + body.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, bytes.length)
  view.setUint32(4, size)
  view.setUint32(8, crc(bytes.slice(0, 8)))
  let offset = 12
  for (const header of headers) {
    bytes.set(header, offset)
    offset += header.length
  }
  bytes.set(body, offset)
  view.setUint32(bytes.length - 4, crc(bytes.slice(0, -4)))
  return bytes
}
const converse = (kind: Step["response"]) => {
  const tool = kind === "tool"
  const events = [frame("messageStart", { role: "assistant" })]
  if (tool)
    events.push(
      frame("contentBlockStart", {
        contentBlockIndex: 0,
        start: { toolUse: { toolUseId: "call_weather", name: "weather" } },
      }),
      frame("contentBlockDelta", { contentBlockIndex: 0, delta: { toolUse: { input: '{"city":' } } }),
      frame("contentBlockDelta", { contentBlockIndex: 0, delta: { toolUse: { input: '"Paris"}' } } }),
    )
  else events.push(frame("contentBlockDelta", { contentBlockIndex: 0, delta: { text: "Hello 世界" } }))
  if (kind === "cancel" || kind === "truncated") return events
  if (kind === "exception")
    return [...events, frame("throttlingException", { message: "secret stream diagnostic" }, true)]
  return [
    ...events,
    frame("contentBlockStop", { contentBlockIndex: 0 }),
    frame("messageStop", { stopReason: tool ? "tool_use" : "end_turn" }),
    frame("metadata", {
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cacheReadInputTokens: 2, cacheWriteInputTokens: 1 },
      metrics: { latencyMs: 1 },
    }),
  ]
}
const mantle = (kind: Step["response"]) => {
  const tool = kind === "tool"
  let sequence = 0
  const event = (type: string, data: unknown) =>
    encoder.encode(
      `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...(data as object) })}\n\n`,
    )
  const item = tool
    ? {
        type: "function_call",
        id: "fc_weather",
        call_id: "call_weather",
        name: "weather",
        arguments: '{"city":"Paris"}',
        status: "completed",
      }
    : {
        type: "message",
        id: "msg_fixture",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "Hello 世界", annotations: [] }],
      }
  const response = {
    id: "resp_fixture",
    object: "response",
    created_at: 1,
    model: "openai.gpt-5.4",
    status: "completed",
    output: [item],
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      input_tokens_details: { cached_tokens: 2 },
      output_tokens_details: { reasoning_tokens: 1 },
    },
  }
  const events = [
    event("response.created", { response: { ...response, status: "in_progress", output: [], usage: null } }),
    event("response.output_item.added", {
      output_index: 0,
      item: tool ? { ...item, arguments: "", status: "in_progress" } : { ...item, content: [], status: "in_progress" },
    }),
  ]
  if (tool)
    events.push(
      event("response.function_call_arguments.delta", {
        item_id: "fc_weather",
        output_index: 0,
        delta: '{"city":"Paris"}',
      }),
    )
  else
    events.push(
      event("response.content_part.added", {
        item_id: "msg_fixture",
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] },
      }),
      event("response.output_text.delta", {
        item_id: "msg_fixture",
        output_index: 0,
        content_index: 0,
        delta: "Hello 世界",
      }),
    )
  if (kind === "cancel" || kind === "truncated") return events
  if (kind === "exception")
    return [...events, event("error", { code: "server_error", message: "secret stream diagnostic", param: null })]
  return [
    ...events,
    event("response.output_item.done", { output_index: 0, item }),
    event("response.completed", { response }),
  ]
}
