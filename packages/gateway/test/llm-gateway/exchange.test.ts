import { NodeCrypto } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import type { Tokens } from "@bymorning/schema/usage"
import { Model as ModelSchema } from "@bymorning/schema/model"
import { Provider as ProviderSchema } from "@bymorning/schema/provider"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { Effect, Layer, Redacted, Ref, Stream } from "effect"
import { Headers, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Exchange } from "../../src/llm-gateway/exchange.js"
import { StreamError } from "../../src/llm-gateway.js"
import { Usage } from "@bymorning/core/usage"
import { Plugin } from "@bymorning/core/plugin"

const model = ModelSchema.Info.make({
  id: "gpt-5.6-luna",
  provider: ProviderSchema.Bymorning,
  apiID: "upstream-luna",
  name: "Luna",
  description: "",
  status: "active",
  releaseDate: "2026-01-01",
  lastUpdated: "2026-01-01",
  openWeights: false,
  capabilities: { temperature: true, reasoning: true, attachment: false, tools: true, input: [], output: [] },
  variants: [],
  limit: { context: 1_000_000, output: 100_000 },
  cost: { input: 1, output: 1, cache: { read: 0, write: 0 } },
})

const workspaceID = Workspace.ID.create()
const principal = { type: "user", userID: User.ID.create() } as const

const unused = (..._input: ReadonlyArray<unknown>) => Effect.die("unused")

/** Priced cost the fake Usage service reports for every recorded exchange. */
const recordedCost = 12

const recordingUsage = (records: Ref.Ref<ReadonlyArray<Usage.RecordInput>>) =>
  Usage.Service.of({
    record: (input) => Ref.update(records, (current) => [...current, input]).pipe(Effect.as({ cost: recordedCost })),
    spend: unused,
    list: unused,
    records: unused,
    overview: unused,
    leaderboard: unused,
  })

const failingUsage = () =>
  Usage.Service.of({
    record: () => Effect.fail(new Usage.StoreError({ operation: "record", cause: "storage unavailable" })),
    spend: unused,
    list: unused,
    records: unused,
    overview: unused,
    leaderboard: unused,
  })

/** One upstream SSE response delivered in whole chunks, optionally erroring mid-stream. */
const sse = (chunks: ReadonlyArray<string>, error?: unknown) =>
  HttpClient.make((request) =>
    Effect.sync(() =>
      HttpClientResponse.fromWeb(
        request,
        new Response(
          new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder()
              for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
              if (error !== undefined) controller.error(error)
              else controller.close()
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
      ),
    ),
  )

const layer = (http: HttpClient.HttpClient, usage: Usage.Interface) =>
  Layer.mergeAll(
    Exchange.layer.pipe(Layer.provide(Layer.mergeAll(Layer.succeed(HttpClient.HttpClient, http), NodeCrypto.layer))),
    Layer.succeed(Usage.Service, usage),
    Plugin.Hooks.layer,
  )

interface ExchangeCall {
  readonly reply: {
    readonly status: number
    readonly body: Stream.Stream<Uint8Array, StreamError>
  }
  readonly settled: ReadonlyArray<number>
}

const invoke = (settles: Array<Tokens | undefined>, callerHeaders: Headers.Input = {}, stream = true) =>
  Effect.gen(function* () {
    const hooks = yield* Plugin.Hooks.Service
    yield* hooks.register("gateway", "model.invoke", (input) =>
      Effect.sync(() => {
        input.onUsage((tokens) =>
          Effect.sync(() => {
            settles.push(tokens)
          }),
        )
      }),
    )
    const invocation = yield* hooks.open({
      domain: "gateway",
      event: {
        id: "test-attempt",
        workspaceID,
        protocol: "openai-chat",
        stream,
        publicModel: "public-model",
        model: { provider: model.provider, id: model.id },
      },
    })
    const settled: Array<number> = []
    const exchange = yield* Exchange.Service
    const reply = yield* exchange.invoke({
      request: { protocol: "openai-chat", model: "public-model", stream, body: {} },
      headers: Headers.fromInput(callerHeaders),
      destination: {
        model,
        format: "oa-compat",
        baseURL: new URL("https://provider.example/v1"),
        headers: Redacted.make({ authorization: "Bearer provider-secret" }),
      },
      workspaceID,
      principal,
      endpointID: "provider/test",
      publicModel: "public-model",
      requestID: "test-attempt",
      invocation,
      settle: (amount) => Effect.sync(() => { settled.push(amount) }),
    })
    return { reply, settled } as ExchangeCall
  })

const bodyText = (body: Stream.Stream<Uint8Array, StreamError>) =>
  Effect.map(Stream.runCollect(body), (chunks) =>
    Array.from(chunks, (chunk) => new TextDecoder().decode(chunk)).join(""),
  )

const tokens = { input: 10, output: 4, reasoning: 0, cacheRead: 0, cacheWrite: 0 }

describe("LLM Gateway exchange", () => {
  it.effect("forwards bytes unchanged and records settled usage once across split events", () => {
    const settles: Array<Tokens | undefined> = []
    const records = Ref.makeUnsafe<ReadonlyArray<Usage.RecordInput>>([])
    return Effect.gen(function* () {
      const { reply, settled } = yield* invoke(settles)
      expect(yield* bodyText(reply.body)).toBe(
        'data: {"usage":{"prompt_tokens":10,"completion_tokens":4}}\n\ndata: [DONE]\n\n',
      )
      expect(reply.status).toBe(200)
      expect(settled).toEqual([recordedCost])
      expect(yield* Ref.get(records)).toMatchObject([
        { model: "public-model", upstreamModel: "upstream-luna", tokens, principal },
      ])
      expect(settles).toEqual([tokens])
    }).pipe(
      Effect.provide(
        layer(
          sse(['data: {"usage":{"prompt_tok', 'ens":10,"completion_tokens":4}}\n\ndata: [DONE]\n\n']),
          recordingUsage(records),
        ),
      ),
    )
  })

  it.effect("preserves native CRLF SSE bytes while observing a multiline data event without retrying", () => {
    const settles: Array<Tokens | undefined> = []
    const records = Ref.makeUnsafe<ReadonlyArray<Usage.RecordInput>>([])
    const body =
      'retry: 0\r\nevent: message\r\ndata: {"usage":{"prompt_tokens":10,\r\ndata: "completion_tokens":4}}\r\n\r\n'
    return Effect.gen(function* () {
      const { reply, settled } = yield* invoke(settles)
      expect(yield* bodyText(reply.body)).toBe(body)
      expect(settled).toEqual([recordedCost])
      expect(yield* Ref.get(records)).toMatchObject([{ tokens }])
      expect(settles).toEqual([tokens])
    }).pipe(
      Effect.provide(layer(sse([body.slice(0, 29), body.slice(29, 63), body.slice(63)]), recordingUsage(records))),
    )
  })

  it.effect("notifies observers with normalized cache read and write tokens", () => {
    const settles: Array<Tokens | undefined> = []
    return Effect.gen(function* () {
      const { reply, settled } = yield* invoke(settles)
      yield* bodyText(reply.body)
      expect(settled).toEqual([recordedCost])
      expect(settles).toEqual([{ input: 10, output: 4, reasoning: 0, cacheRead: 100, cacheWrite: 50 }])
    }).pipe(
      Effect.provide(
        layer(
          sse([
            'data: {"usage":{"prompt_tokens":110,"completion_tokens":4,"prompt_tokens_details":{"cached_tokens":100,"cache_creation_input_tokens":50}}}\n\n',
          ]),
          recordingUsage(Ref.makeUnsafe<ReadonlyArray<Usage.RecordInput>>([])),
        ),
      ),
    )
  })

  it.effect("flushes a trailing event that lacks a final delimiter on completion", () => {
    const settles: Array<Tokens | undefined> = []
    const records = Ref.makeUnsafe<ReadonlyArray<Usage.RecordInput>>([])
    return Effect.gen(function* () {
      const { reply, settled } = yield* invoke(settles)
      expect(yield* bodyText(reply.body)).toBe('data: {"usage":{"prompt_tokens":10,"completion_tokens":4}}')
      expect(settled).toEqual([recordedCost])
      expect(yield* Ref.get(records)).toMatchObject([{ tokens }])
      expect(settles).toEqual([tokens])
    }).pipe(
      Effect.provide(
        layer(sse(['data: {"usage":{"prompt_tokens":10,"completion_tokens":4}}']), recordingUsage(records)),
      ),
    )
  })

  it.effect("fails typed when one buffered Provider event exceeds the byte limit", () => {
    const settles: Array<Tokens | undefined> = []
    const records = Ref.makeUnsafe<ReadonlyArray<Usage.RecordInput>>([])
    return Effect.gen(function* () {
      const { reply, settled } = yield* invoke(settles)
      const error = yield* Stream.runDrain(reply.body).pipe(Effect.flip)
      expect(error).toBeInstanceOf(StreamError)
      expect(settled).toEqual([])
      expect(yield* Ref.get(records)).toEqual([])
      expect(settles).toEqual([])
      // 12M two-byte characters: 24M bytes, which only a byte-based limit rejects.
    }).pipe(Effect.provide(layer(sse([`data: {"x":"${"é".repeat(12 * 1024 * 1024)}"`]), recordingUsage(records))))
  })

  it.effect("does not record or settle usage when the upstream stream fails mid-way", () => {
    const settles: Array<Tokens | undefined> = []
    const records = Ref.makeUnsafe<ReadonlyArray<Usage.RecordInput>>([])
    return Effect.gen(function* () {
      const { reply, settled } = yield* invoke(settles)
      const error = yield* Stream.runDrain(reply.body).pipe(Effect.flip)
      expect(error).toBeInstanceOf(StreamError)
      expect(settled).toEqual([])
      expect(yield* Ref.get(records)).toEqual([])
      expect(settles).toEqual([])
    }).pipe(
      Effect.provide(
        layer(
          sse(['data: {"id":1}\n\n', 'data: {"usage":{"prompt_tokens":10,"completion_tokens":4}}\n\n'], "reset"),
          recordingUsage(records),
        ),
      ),
    )
  })

  it.effect("cancelling the body discards unobserved usage without settling the reservation", () => {
    const settles: Array<Tokens | undefined> = []
    const records = Ref.makeUnsafe<ReadonlyArray<Usage.RecordInput>>([])
    return Effect.gen(function* () {
      const { reply, settled } = yield* invoke(settles)
      const forwarded = yield* Stream.runCollect(Stream.take(reply.body, 1))
      expect(Array.from(forwarded, (chunk) => new TextDecoder().decode(chunk)).join("")).toBe('data: {"id":1}\n\n')
      expect(settled).toEqual([])
      expect(yield* Ref.get(records)).toEqual([])
      expect(settles).toEqual([])
    }).pipe(
      Effect.provide(
        layer(
          sse(['data: {"id":1}\n\n', 'data: {"usage":{"prompt_tokens":10,"completion_tokens":4}}\n\n']),
          recordingUsage(records),
        ),
      ),
    )
  })

  it.effect("fails the stream and skips usage observers when persistence fails", () => {
    const settles: Array<Tokens | undefined> = []
    return Effect.gen(function* () {
      const { reply, settled } = yield* invoke(settles)
      const error = yield* bodyText(reply.body).pipe(Effect.flip)
      expect(error).toBeInstanceOf(StreamError)
      expect(error.cause).toMatchObject({ _tag: "LLMGateway.UnavailableError" })
      expect(settled).toEqual([])
      expect(settles).toEqual([])
    }).pipe(
      Effect.provide(layer(sse(['data: {"usage":{"prompt_tokens":10,"completion_tokens":4}}\n\n']), failingUsage())),
    )
  })

  it.effect("treats usage counts outside the Tokens schema as unobserved", () => {
    const settles: Array<Tokens | undefined> = []
    const records = Ref.makeUnsafe<ReadonlyArray<Usage.RecordInput>>([])
    return Effect.gen(function* () {
      const { reply, settled } = yield* invoke(settles)
      expect(yield* bodyText(reply.body)).toBe('data: {"usage":{"prompt_tokens":"many","completion_tokens":4}}\n\n')
      expect(settled).toEqual([])
      expect(yield* Ref.get(records)).toEqual([])
      expect(settles).toEqual([])
    }).pipe(
      Effect.provide(
        layer(sse(['data: {"usage":{"prompt_tokens":"many","completion_tokens":4}}\n\n']), recordingUsage(records)),
      ),
    )
  })

  it.effect("passes non-2xx metadata and bodies through without usage observation", () => {
    const settles: Array<Tokens | undefined> = []
    const records = Ref.makeUnsafe<ReadonlyArray<Usage.RecordInput>>([])
    return Effect.gen(function* () {
      const { reply, settled } = yield* invoke(settles)
      expect(reply.status).toBe(502)
      expect(yield* bodyText(reply.body)).toBe('{"error":true}')
      expect(settled).toEqual([])
      expect(yield* Ref.get(records)).toEqual([])
      expect(settles).toEqual([])
    }).pipe(
      Effect.provide(
        layer(
          HttpClient.make((request) =>
            Effect.sync(() => HttpClientResponse.fromWeb(request, new Response('{"error":true}', { status: 502 }))),
          ),
          recordingUsage(records),
        ),
      ),
    )
  })

  it.effect("does not forward caller Proxy-Authorization to the Provider", () => {
    const settles: Array<Tokens | undefined> = []
    const records = Ref.makeUnsafe<ReadonlyArray<Usage.RecordInput>>([])
    const sent = Ref.makeUnsafe<ReadonlyArray<Request>>([])
    return Effect.gen(function* () {
      yield* invoke(settles, { "proxy-authorization": "Basic proxy-caller", "x-client": "preserved" }, false)
      const [upstream] = yield* Ref.get(sent)
      if (upstream === undefined) return yield* Effect.die("Provider request missing")
      expect(upstream.headers.get("proxy-authorization")).toBeNull()
      expect(upstream.headers.get("x-client")).toBe("preserved")
    }).pipe(
      Effect.provide(
        layer(
          HttpClient.make((request) =>
            Effect.gen(function* () {
              const web = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie)
              yield* Ref.update(sent, (current) => [...current, web])
              return HttpClientResponse.fromWeb(request, Response.json({}))
            }),
          ),
          recordingUsage(records),
        ),
      ),
    )
  })

  it.effect("removes injected Provider credentials from a reflected non-2xx body", () => {
    const settles: Array<Tokens | undefined> = []
    const records = Ref.makeUnsafe<ReadonlyArray<Usage.RecordInput>>([])
    const reflected = 'upstream rejected: authorization "Bearer provider-secret" malformed'
    return Effect.gen(function* () {
      const { reply, settled } = yield* invoke(settles)
      expect(reply.status).toBe(401)
      expect(yield* bodyText(reply.body)).toBe('upstream rejected: authorization "[redacted]" malformed')
      expect(settled).toEqual([])
      expect(yield* Ref.get(records)).toEqual([])
      expect(settles).toEqual([])
    }).pipe(
      Effect.provide(
        layer(
          HttpClient.make((request) =>
            Effect.sync(() =>
              HttpClientResponse.fromWeb(request, new Response(reflected, { status: 401, headers: { "content-type": "text/plain" } })),
            ),
          ),
          recordingUsage(records),
        ),
      ),
    )
  })

  it.effect("strips caller credentials, preserves other headers, and records non-stream usage once", () => {
    const settles: Array<Tokens | undefined> = []
    const records = Ref.makeUnsafe<ReadonlyArray<Usage.RecordInput>>([])
    const sent = Ref.makeUnsafe<ReadonlyArray<Request>>([])
    const http = HttpClient.make((request) =>
      Effect.gen(function* () {
        const web = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie)
        yield* Ref.update(sent, (current) => [...current, web])
        return HttpClientResponse.fromWeb(request, Response.json({ usage: { prompt_tokens: 4, completion_tokens: 2 } }))
      }),
    )
    return Effect.gen(function* () {
      const { reply, settled } = yield* invoke(
        settles,
        {
          authorization: "Bearer caller-token",
          "x-api-key": "caller-api-key",
          cookie: "caller-cookie",
          "x-client": "preserved",
        },
        false,
      )
      expect(reply.status).toBe(200)
      expect(settled).toEqual([recordedCost])
      expect(yield* bodyText(reply.body)).toBe('{"usage":{"prompt_tokens":4,"completion_tokens":2}}')
      const [upstream] = yield* Ref.get(sent)
      if (upstream === undefined) return yield* Effect.die("Provider request missing")
      expect(upstream.headers.get("authorization")).toBe("Bearer provider-secret")
      expect(upstream.headers.get("x-api-key")).toBeNull()
      expect(upstream.headers.get("cookie")).toBeNull()
      expect(upstream.headers.get("x-client")).toBe("preserved")
      expect(yield* Ref.get(records)).toEqual([
        expect.objectContaining({
          model: "public-model",
          upstreamModel: "upstream-luna",
          tokens: { input: 4, output: 2, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        }),
      ])
      expect(settles).toEqual([{ input: 4, output: 2, reasoning: 0, cacheRead: 0, cacheWrite: 0 }])
    }).pipe(Effect.provide(layer(http, recordingUsage(records))))
  })
})