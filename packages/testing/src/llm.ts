import { Session } from "@bymorning/schema/session"
import { NodeHttpServer } from "@effect/platform-node"
import { Cause, Context, Deferred, Effect, Exit, Layer, Schema, Stream } from "effect"
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { createServer } from "node:http"

/** The model request purposes emitted by the Session model hook. */
export const Purpose = Schema.Literals(["assistant", "title", "compaction", "generate", "route"])
/** A separately scripted stream of requests within a Session. */
export type Purpose = typeof Purpose.Type

const Call = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("function"),
  function: Schema.Struct({ name: Schema.String, arguments: Schema.String }),
})
const Body = Schema.Struct({
  model: Schema.String,
  stream: Schema.optionalKey(Schema.Boolean),
  reasoning_effort: Schema.optionalKey(Schema.String),
  messages: Schema.Array(
    Schema.Struct({
      role: Schema.Literals(["system", "developer", "user", "assistant", "tool", "function"]),
      content: Schema.optionalKey(Schema.Json),
      tool_call_id: Schema.optionalKey(Schema.String),
      tool_calls: Schema.optionalKey(Schema.Array(Call)),
      name: Schema.optionalKey(Schema.String),
    }),
  ),
  tools: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        type: Schema.Literal("function"),
        function: Schema.Struct({
          name: Schema.String,
          description: Schema.optionalKey(Schema.String),
          parameters: Schema.Json,
        }),
      }),
    ),
  ),
})

/** A parsed OpenAI Chat request with the actual Session hook correlation. */
export const Request = Schema.Struct({
  ...Body.fields,
  sessionID: Session.ID,
  purpose: Purpose,
})
/** A parsed request supplied to script assertions and retained in history. */
export type Request = typeof Request.Type

/** One semantic stream event; gates pause without relying on elapsed time. */
export type Event =
  | { readonly text: string }
  | { readonly reasoning: string }
  | { readonly tool: { readonly id: string; readonly name: string; readonly input: Schema.Json } }
  | { readonly gate: string }

/** External model behavior; cancellation must be caused by the caller. */
export type Response =
  | {
      readonly type: "success"
      readonly events: ReadonlyArray<Event>
      readonly usage?: { readonly input: number; readonly output: number }
    }
  | { readonly type: "error"; readonly status: number; readonly message: string }
  | { readonly type: "cancel"; readonly gate: string; readonly text?: ReadonlyArray<string> }
  | { readonly type: "malformed"; readonly data: string }
  | { readonly type: "truncated"; readonly text: ReadonlyArray<string> }

/** A required request assertion followed by the model's external response. */
export interface Step {
  readonly expect: (request: Request) => void
  readonly response: Response
}

/** A script mismatch retained independently of the application's error handling. */
export class ScriptError extends Schema.TaggedError<ScriptError>()("TestLLM.ScriptError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/** Failure to acquire the local model listener. */
export class SetupError extends Schema.TaggedError<SetupError>()("TestLLM.SetupError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/** Scoped model endpoint and deterministic script controls. */
export interface Interface {
  readonly url: string
  readonly expect: (
    sessionID: Session.ID,
    purpose: Purpose,
    steps: ReadonlyArray<Step>,
  ) => Effect.Effect<void, ScriptError>
  // @effect-diagnostics-next-line lazyEffect:off
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
  readonly wait: (sessionID: Session.ID, purpose: Purpose, index?: number) => Effect.Effect<Request, ScriptError>
  readonly settled: (sessionID: Session.ID, purpose: Purpose, index?: number) => Effect.Effect<void, ScriptError>
  readonly waitGate: (name: string) => Effect.Effect<void, ScriptError>
  readonly release: (name: string) => Effect.Effect<void, ScriptError>
  // @effect-diagnostics-next-line lazyEffect:off
  readonly verify: () => Effect.Effect<void, ScriptError>
}

type Scheduled = {
  readonly step: Step
  readonly received: Deferred.Deferred<Request>
  readonly settled: Deferred.Deferred<void>
  state: "pending" | "active" | "settled"
}

/** Acquire a loopback OpenAI Chat endpoint; scope finalization verifies every script. */
export const make = Effect.fn("TestLLM.make")(function* () {
  const scripts = new Map<string, Array<Scheduled>>()
  const gates = new Map<
    string,
    { readonly reached: Deferred.Deferred<void>; readonly released: Deferred.Deferred<void> }
  >()
  const history: Array<Request> = []
  const failures: Array<ScriptError> = []
  const failed = yield* Deferred.make<never, ScriptError>()
  const record = (error: ScriptError) =>
    Effect.gen(function* () {
      failures.push(error)
      yield* Deferred.fail(failed, error)
    })
  const key = (sessionID: Session.ID, purpose: Purpose) => `${sessionID}/${purpose}`
  const encoder = new TextEncoder()
  const wire = (value: unknown) => encoder.encode(`data: ${JSON.stringify(value)}\n\n`)
  const chunk = (model: string, delta: unknown, finish: "stop" | "tool_calls" | null = null) => ({
    id: "chatcmpl-fixture",
    object: "chat.completion.chunk",
    created: 0,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  })

  const gate = Effect.fn("TestLLM.gate")(function* (name: string) {
    const value = gates.get(name)
    if (value === undefined) return yield* new ScriptError({ message: `Unknown model gate: ${name}` })
    return value
  })
  const scheduled = Effect.fn("TestLLM.scheduled")(function* (sessionID: Session.ID, purpose: Purpose, index: number) {
    const value = scripts.get(key(sessionID, purpose))?.[index]
    if (value === undefined) {
      return yield* new ScriptError({ message: `No scripted request ${key(sessionID, purpose)}[${index}]` })
    }
    return value
  })
  const complete = (value: Scheduled) =>
    Effect.gen(function* () {
      value.state = "settled"
      yield* Deferred.succeed(value.settled, undefined)
    })
  const pause = (name: string) =>
    Effect.gen(function* () {
      const value = yield* gate(name)
      yield* Deferred.succeed(value.reached, undefined)
      yield* Deferred.await(value.released)
    })

  const handle = Effect.gen(function* () {
    const incoming = yield* HttpServerRequest.HttpServerRequest
    if (incoming.method !== "POST" || incoming.url !== "/v1/chat/completions") {
      return yield* new ScriptError({ message: `Unexpected model endpoint: ${incoming.method} ${incoming.url}` })
    }
    const body = yield* incoming.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Body)),
      Effect.mapError((cause) => new ScriptError({ message: "Invalid OpenAI Chat request body", cause })),
    )
    const request = yield* Schema.decodeUnknownEffect(Request)({
      ...body,
      sessionID: incoming.headers["x-bm-test-session"],
      purpose: incoming.headers["x-bm-test-purpose"],
    }).pipe(
      Effect.mapError((cause) => new ScriptError({ message: "Missing or invalid model correlation headers", cause })),
    )
    history.push(request)
    const entry = scripts.get(key(request.sessionID, request.purpose))?.find((item) => item.state === "pending")
    if (entry === undefined) {
      return yield* new ScriptError({ message: `Unexpected model request: ${key(request.sessionID, request.purpose)}` })
    }
    entry.state = "active"
    yield* Deferred.succeed(entry.received, request)
    yield* Effect.try({
      try: () => entry.step.expect(request),
      catch: (cause) =>
        new ScriptError({
          message: `Model request assertion failed: ${key(request.sessionID, request.purpose)}`,
          cause,
        }),
    }).pipe(Effect.onError(() => complete(entry)))
    const response = entry.step.response
    if (response.type === "error") {
      yield* complete(entry)
      return HttpServerResponse.jsonUnsafe(
        { error: { message: response.message, type: "fixture_error", code: "fixture_error" } },
        { status: response.status },
      )
    }
    if (response.type === "malformed") {
      yield* complete(entry)
      return HttpServerResponse.text(response.data, {
        contentType: request.stream ? "text/event-stream" : "application/json",
      })
    }
    const events: ReadonlyArray<Event> =
      response.type === "success" ? response.events : (response.text ?? []).map((text) => ({ text }))
    const usage = response.type === "success" ? (response.usage ?? { input: 10, output: 5 }) : { input: 10, output: 5 }
    const calls = events.flatMap((event) =>
      "tool" in event
        ? [
            {
              id: event.tool.id,
              type: "function",
              function: { name: event.tool.name, arguments: JSON.stringify(event.tool.input) },
            },
          ]
        : [],
    )
    if (request.stream !== true) {
      for (const event of events) if ("gate" in event) yield* pause(event.gate)
      if (response.type === "cancel") {
        const value = yield* gate(response.gate)
        yield* Deferred.succeed(value.reached, undefined)
        return yield* Effect.never.pipe(Effect.ensuring(complete(entry)))
      }
      yield* complete(entry)
      return HttpServerResponse.jsonUnsafe({
        id: "chatcmpl-fixture",
        object: "chat.completion",
        created: 0,
        model: request.model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: events.flatMap((event) => ("text" in event ? [event.text] : [])).join(""),
              ...(calls.length > 0 ? { tool_calls: calls } : {}),
            },
            finish_reason: calls.length > 0 ? "tool_calls" : "stop",
          },
        ],
        usage: {
          prompt_tokens: usage.input,
          completion_tokens: usage.output,
          total_tokens: usage.input + usage.output,
        },
      })
    }
    let toolIndex = 0
    const content = Stream.fromIterable(events).pipe(
      Stream.flatMap((event) => {
        if ("gate" in event) return Stream.fromEffectDrain(pause(event.gate))
        if ("text" in event) return Stream.make(wire(chunk(request.model, { content: event.text })))
        if ("reasoning" in event) return Stream.make(wire(chunk(request.model, { reasoning_content: event.reasoning })))
        return Stream.make(
          wire(
            chunk(request.model, {
              tool_calls: [
                {
                  index: toolIndex++,
                  id: event.tool.id,
                  type: "function",
                  function: { name: event.tool.name, arguments: JSON.stringify(event.tool.input) },
                },
              ],
            }),
          ),
        )
      }),
    )
    const ending =
      response.type === "cancel"
        ? Stream.fromEffectDrain(
            Effect.gen(function* () {
              const value = yield* gate(response.gate)
              yield* Deferred.succeed(value.reached, undefined)
              return yield* Effect.never
            }),
          )
        : response.type === "truncated"
          ? Stream.empty
          : Stream.make(
              wire(chunk(request.model, {}, calls.length > 0 ? "tool_calls" : "stop")),
              wire({
                ...chunk(request.model, {}),
                choices: [],
                usage: {
                  prompt_tokens: usage.input,
                  completion_tokens: usage.output,
                  total_tokens: usage.input + usage.output,
                },
              }),
              encoder.encode("data: [DONE]\n\n"),
            )
    return HttpServerResponse.stream(
      content.pipe(
        Stream.concat(ending),
        Stream.onExit((exit) =>
          Effect.gen(function* () {
            if (Exit.isFailure(exit) && !(response.type === "cancel" && Cause.hasInterruptsOnly(exit.cause))) {
              yield* record(
                new ScriptError({
                  message: `Model stream interrupted unexpectedly: ${key(request.sessionID, request.purpose)}`,
                  cause: exit.cause,
                }),
              )
            }
            yield* complete(entry)
          }),
        ),
      ),
      { contentType: "text/event-stream", headers: { "cache-control": "no-cache" } },
    )
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        yield* record(error)
        return HttpServerResponse.jsonUnsafe({ error: { message: error.message } }, { status: 500 })
      }),
    ),
  )

  const context = yield* Layer.build(
    HttpRouter.serve(HttpRouter.add("*", "/*", handle), { disableListenLog: true, disableLogger: true }).pipe(
      Layer.provideMerge(NodeHttpServer.layer(createServer, { host: "127.0.0.1", port: 0 })),
    ),
  ).pipe(Effect.mapError((cause) => new SetupError({ message: "Could not start scripted model listener", cause })))
  const url = `${HttpServer.formatAddress(Context.get(context, HttpServer.HttpServer).address)}/v1`
  const verify = Effect.fn("TestLLM.verify")(function* () {
    const remaining = [...scripts].flatMap(([key, steps]) =>
      steps.flatMap((entry, index) => (entry.state === "settled" ? [] : [`${key}[${index}] ${entry.state}`])),
    )
    if (failures.length > 0 || remaining.length > 0) {
      return yield* new ScriptError({
        message: [
          ...failures.map((error) => error.message),
          ...remaining.map((step) => `Unconsumed model step: ${step}`),
        ].join("\n"),
        ...(failures.length > 0 ? { cause: failures } : {}),
      })
    }
  })
  yield* Effect.addFinalizer(() => verify().pipe(Effect.orDie))

  return {
    url,
    expect: Effect.fn("TestLLM.expect")(function* (
      sessionID: Session.ID,
      purpose: Purpose,
      steps: ReadonlyArray<Step>,
    ) {
      const names = steps.flatMap(({ response }) =>
        response.type === "cancel"
          ? [response.gate]
          : response.type === "success"
            ? response.events.flatMap((event) => ("gate" in event ? [event.gate] : []))
            : [],
      )
      if (new Set(names).size !== names.length || names.some((name) => gates.has(name))) {
        return yield* new ScriptError({ message: "Model gate names must be unique within an Application fixture" })
      }
      for (const name of names)
        gates.set(name, { reached: yield* Deferred.make<void>(), released: yield* Deferred.make<void>() })
      const entries: Array<Scheduled> = []
      for (const step of steps)
        entries.push({
          step,
          received: yield* Deferred.make<Request>(),
          settled: yield* Deferred.make<void>(),
          state: "pending",
        })
      const id = key(sessionID, purpose)
      scripts.set(id, [...(scripts.get(id) ?? []), ...entries])
    }),
    list: Effect.fn("TestLLM.list")(() => Effect.sync(() => [...history])),
    wait: Effect.fn("TestLLM.wait")(function* (sessionID: Session.ID, purpose: Purpose, index = 0) {
      return yield* Deferred.await((yield* scheduled(sessionID, purpose, index)).received).pipe(
        Effect.raceFirst(Deferred.await(failed)),
      )
    }),
    settled: Effect.fn("TestLLM.settled")(function* (sessionID: Session.ID, purpose: Purpose, index = 0) {
      yield* Deferred.await((yield* scheduled(sessionID, purpose, index)).settled).pipe(
        Effect.raceFirst(Deferred.await(failed)),
      )
    }),
    waitGate: Effect.fn("TestLLM.waitGate")(function* (name: string) {
      yield* Deferred.await((yield* gate(name)).reached).pipe(Effect.raceFirst(Deferred.await(failed)))
    }),
    release: Effect.fn("TestLLM.release")(function* (name: string) {
      yield* Deferred.succeed((yield* gate(name)).released, undefined)
    }),
    verify,
  } satisfies Interface
})

/** Scripted external transport for real Application model workflows. */
export * as TestLLM from "./llm.js"
