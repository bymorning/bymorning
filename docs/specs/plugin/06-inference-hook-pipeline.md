# 06 — Concentrate the physical inference hook pipeline

## Summary

Every physical model inference (`assistant`, `generate`, `title`, `compaction`) replays the same hook ordering — `model.request` → `context` → `http.request` → provider → `http.response` — but the ordering, the mutable hook payload construction, provider-context assembly, tool re-binding, and defect translation are re-implemented across four call sites with three different error vocabularies. This spec proposes one internal Module, `SessionInference` (`packages/core/src/session/inference.ts`), whose Interface is `plan(identity)` and `stream(plan, content)`; it privately owns hook ordering, payload construction, tool re-binding, the HTTP middleware, and one consistent error model. `PluginHooks` itself stays untouched — it is already deep; this concentrates its *callers*.

## Current shape

The code names this concept "physical inference" (`provider.ts:82` "Code-backed Provider discovery and physical inference", `session-hooks.ts:8` "Physical inference purpose", `model-request.ts:19` "plan one physical model request"). Inbound Provider-native inference belongs to the public `LLMGateway` Core domain; the outbound Session pipeline remains separate:

- `packages/core/src/session/model-request.ts:72-175` — routing policy, escalation, endpoint rules, the `model.request` hook (`177-198`), defect→`Failure` translation (`55-67`), resolver call (`200-205`), and `PolicyEnforced` publishing (`207-234`). Deep; keep the behavior, move the home.
- `packages/core/src/session/http.ts:18-66` — request/response hook middleware; defect→`Provider.FailureError` translation at `9-16`.
- `packages/core/src/plugin/hooks.ts:69-80` — `trigger` with provider-scoped filtering (`86-91`). Deep, KEEP.
- `packages/plugin/src/session-hooks.ts:9-64` — public mutable payload types. Unchanged.

Per-caller sequence today:

| Caller | Hooks triggered, in order | Provider context built | Defect/error translation |
| --- | --- | --- | --- |
| `runner.ts` (`assistant`) | `model.request` (`runner.ts:140` → `model-request.ts:183`) → `context` (`runner.ts:350`) → `http.request`/`http.response` (`runner.ts:375` → `http.ts:27,57`) | `runner.ts:367-374` rebuilds `Provider.RequestContext` from the `Plan`; tools re-bound to originals at `361-366` | `model.request` hook defects → `SessionModelRequest.Failure` (`model-request.ts:55-67`) → `ResolutionError` (`runner.ts:156`) → recorded `SessionError.Provider` (`runner.ts:231`); `context` hook defects **die** (uncaught, `runner.ts:350`); HTTP hook defects → `Provider.FailureError("Provider HTTP hook failed")` (`http.ts:9-16`); stream failures → retry / overflow / `SessionError.Provider` (`runner.ts:407-444`) |
| `session-operations.ts` `generate` | `model.request` (`93`) → `context` (`110`) → HTTP hooks (`135`) | `session-operations.ts:128-134` | plan failure → `Provider.FailureError({ cause: "Provider request failed" })` — message discarded (`108`); `context` hook defects die; HTTP hook defects → `Provider.FailureError` (`http.ts:9-16`) |
| `title.ts` | `model.request` (`112`) → HTTP hooks (`140`); **no `context` hook** | `title.ts:132-139` | plan failure → log + `Effect.option`, silent abort (`128-131`); stream failure swallowed (`163`) |
| `compaction.ts` (`compact:323`, `compactManual:366` → `execute`) | `model.request` (`323`, `366`) → HTTP hooks (`232`); **no `context` hook** | `compaction.ts:224-231` | plan failure → `SessionError.Provider("Compaction model routing failed")` (`341-342`, `384-388`); stream failure → `"Compaction exceeded the model context window"` / `"Compaction provider execution failed"` (`265-275`) |

The cost is per-caller ceremony, not per-caller intent. Every `plan` call repeats eight `Effect.provideService` lines — `runner.ts:148-155`, `session-operations.ts:100-107`, `title.ts:120-127`, `compaction.ts:331-338` and `374-381` — and three of the eight (`Model.Service`, `Provider.Service`, `Permission.Service`) are not even in `plan`'s requirements (`model-request.ts` uses none of them). Four callers each rebuild `Provider.RequestContext` from a `Plan`, four construct `SessionHttp.middleware` and re-provide `PluginHooks` to it, three re-implement text-delta collection. Adding an inference purpose, a hook payload field, or a defect rule means editing every path; "the interface is the test surface" only holds for `model-request.test.ts`, not for the pipeline as a whole.

## Proposed interface

New file `packages/core/src/session/inference.ts`. **Internal to `packages/core`** — not re-exported through any public package surface. The public payload types in `packages/plugin/src/session-hooks.ts` are unchanged; plugins see the same hooks in the same order.

```ts
export * as SessionInference from "./inference.js"

import type { LLMEvent } from "@opencode-ai/ai/schema/events"
import type { Message, SystemPart, ToolChoice } from "@opencode-ai/ai/schema/messages"
import { ToolDefinition } from "@opencode-ai/ai/schema/messages"
import type { RequestInput } from "@opencode-ai/ai/llm"
import type { Agent } from "@bymorning/schema/agent"
import type { ID as MessageID } from "@bymorning/schema/message"
import type { Model as ModelSchema } from "@bymorning/schema/model"
import type { Project } from "@bymorning/schema/project"
import type { Session } from "@bymorning/schema/session"
import type { ModelRequestPurpose, SessionHooks } from "@bymorning/plugin/session-hooks"
import { Context, Effect, Schema, Stream } from "effect"

/** Physical inference purpose — the Session policy hook vocabulary. */
export type Purpose = ModelRequestPurpose

/** Identity of one physical model request before routing. */
export interface PlanInput {
  readonly purpose: Purpose
  readonly sessionID: Session.ID
  readonly projectID?: Project.ID
  readonly messageID?: MessageID
  readonly agent: Agent.ID
  readonly requestedModel: ModelSchema.Ref
}

/** Validated, executable destination for one physical model request. */
export interface Plan {
  readonly purpose: Purpose
  readonly sessionID: Session.ID
  readonly projectID?: Project.ID
  readonly messageID?: MessageID
  readonly agent: Agent.ID
  readonly requestedModel: ModelSchema.Ref
  readonly model: ModelSchema.Ref
  readonly resolved: ModelResolver.Resolved
  readonly baseURL?: string
  readonly headers: Readonly<Record<string, string>>
}

/** Purpose-specific content of one planned inference. `system` is omitted when empty. */
export interface StreamInput {
  readonly plan: Plan
  readonly system: ReadonlyArray<SystemPart>
  readonly messages: ReadonlyArray<Message>
  readonly tools: ReadonlyArray<ToolDefinition>
  readonly toolChoice: ToolChoice
}

/** One started physical inference: the event stream plus Tool re-binding for dispatch. */
export interface Streamed {
  readonly events: Stream.Stream<
    LLMEvent,
    Provider.FailureError | Provider.ContextOverflowError | HookError
  >
  /** Post-hook Tool name → admitted Tool name, for execution dispatch. */
  readonly toolNames: ReadonlyMap<string, string>
}

/** A routing policy, route target, or destination resolution produced no executable request. */
export class RoutingError extends Schema.TaggedError<RoutingError>()("SessionInference.RoutingError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/** A plugin callback failed during a physical inference stage. */
export class HookError extends Schema.TaggedError<HookError>()("SessionInference.HookError", {
  stage: Schema.Literals(["model.request", "context", "http.request", "http.response"]),
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/** @internal Physical inference execution for one Session. Not public plugin surface. */
export interface Interface {
  /** Apply request policy and resolve one executable physical destination. */
  readonly plan: (input: PlanInput) => Effect.Effect<Plan, RoutingError | HookError>
  /** Trigger the context hook, apply system policy, and start one physical inference. */
  readonly stream: (input: StreamInput) => Effect.Effect<Streamed, HookError>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/core/SessionInference") {}

/** @internal Requires the Workspace plugin authority, policy, admission, resolver, and provider. */
export const layer: Layer.Layer<
  Service,
  never,
  | PluginHooks.Service
  | Policy.Service
  | Bus.Service
  | SessionToolAdmission.Service
  | ModelResolver.Service
  | Provider.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    /* … implementation sketch below … */
  }),
)
```

Notes on the shape:

- `plan` is today's `SessionModelRequest.plan` moved wholesale, with `Failure` split into `RoutingError` (policy/routing/resolver) and `HookError` (plugin callback or malformed hook output at the `model.request` stage). `Plan`, `PlanInput` keep today's fields (`model-request.ts:20-41`) so runner keeps `resolved`, `requestedModel`, `model` for recorder and events.
- `stream` derives context-hook participation from purpose — `assistant` and `generate` only, matching the only existing trigger sites (`runner.ts:350`, `session-operations.ts:110`) versus the deliberate absence in `title.ts` and `compaction.ts`. That table is now one constant in one file, not four callers' knowledge.
- `Streamed.toolNames` is the only state the runner needs back out of the hook pipeline (post-hook Tool name → admitted Tool name) for dispatch.
- `HookError` in `events` covers the HTTP stages, which necessarily fail mid-stream; `stream`'s own channel covers the `context` stage, which fails before any bytes.

## Implementation sketch

`plan` is the body of `SessionModelRequest.plan` (`model-request.ts:72-234`) moved verbatim, with two deltas:

```ts
// delta 1 — hook defects become HookError (was callbackFailure → Failure, model-request.ts:55-67)
const hookFailure = (stage: HookError["stage"], message: string, cause: Cause.Cause<never>) =>
  Cause.hasInterrupts(cause)
    ? Effect.failCause(cause)
    : Effect.logError(message, { cause }).pipe(
        Effect.andThen(Effect.fail(new HookError({ stage, message, cause }))),
      )

// delta 2 — malformed hook output is a hook problem, not a routing problem (model-request.ts:193-197)
const output = yield* Schema.decodeUnknownEffect(Output)({
  model: routed.model,
  ...(routed.baseURL === undefined ? {} : { baseURL: routed.baseURL }),
  headers: routed.headers,
}).pipe(Effect.mapError((cause) => new HookError({ stage: "model.request", message: "Invalid Session model request policy output", cause })))
```

Everything else in `plan` — policy evaluation order, escalation purpose filter, endpoint env-header fail-closed, guardrail deny publishing, `ModelResolver` call — is unchanged code with `RoutingError` in place of `Failure` (`invalid()` at `model-request.ts:69`).

`stream` and its helpers, all below the `Service` export per the style guide:

```ts
/** Purposes whose assembled content is exposed to the mutable session.context hook. */
const contextHookPurposes: ReadonlySet<Purpose> = new Set(["assistant", "generate"])

const stream = Effect.fn("SessionInference.stream")(function* (input: StreamInput) {
  const context = providerContext(input.plan)
  const tools = admittedTools(input.tools)
  const hooked = contextHookPurposes.has(input.plan.purpose)
    ? yield* triggerContextHook(input, tools.payload)
    : { system: input.system, messages: input.messages, tools: tools.payload }
  const system = contextHookPurposes.has(input.plan.purpose)
    ? yield* SessionContextPolicy.apply({
        sessionID: input.plan.sessionID,
        ...(input.plan.messageID === undefined ? {} : { messageID: input.plan.messageID }),
        agent: input.plan.agent,
        model: input.plan.model,
        system: hooked.system,
      })
    : hooked.system
  const events = providers.stream({
    context,
    selection: input.plan.resolved.selection,
    runtimeModel: input.plan.resolved.runtimeModel,
    authentication: input.plan.resolved.authentication,
    http: httpMiddleware(context),
    messages: hooked.messages,
    ...(system.length === 0 ? {} : { system }),
    tools: tools.bind(hooked.tools).definitions,
    toolChoice: input.toolChoice,
  })
  return { events, toolNames: tools.bind(hooked.tools).names } satisfies Streamed
})

const providerContext = (plan: Plan): Provider.RequestContext => ({
  purpose: plan.purpose,
  sessionID: plan.sessionID,
  ...(plan.messageID === undefined ? {} : { messageID: plan.messageID }),
  agent: plan.agent,
  requestedModel: plan.requestedModel,
  model: plan.model,
})

const triggerContextHook = Effect.fn("SessionInference.triggerContextHook")(function* (
  input: StreamInput,
  tools: SessionHooks["context"]["tools"],
) {
  const payload: SessionHooks["context"] = {
    purpose: input.plan.purpose,
    sessionID: input.plan.sessionID,
    ...(input.plan.messageID === undefined ? {} : { messageID: input.plan.messageID }),
    agent: input.plan.agent,
    requestedModel: input.plan.requestedModel,
    model: input.plan.model,
    system: [...input.system],
    messages: [...input.messages],
    tools,
  }
  return yield* hooks
    .trigger("session", "context", payload)
    .pipe(Effect.catchCause((cause) => hookFailure("context", "Session context hook failed", cause)))
})

/**
 * Re-bind hook-mutated Tool views to admitted definitions. Identity match first so a plugin
 * that kept the payload object keeps the admitted definition; name fallback covers replaced
 * views; anything with no admitted original is dropped, so plugins cannot inject Tools.
 */
const admittedTools = (definitions: ReadonlyArray<ToolDefinition>) => {
  const registry = new Map(definitions.map((definition) => [definition.name, definition]))
  const given = new Map(
    definitions.map(
      (definition) =>
        [{ description: definition.description, input: definition.inputSchema }, definition] as const,
    ),
  )
  const payload = Object.fromEntries(Array.from(given, ([view, definition]) => [definition.name, view]))
  const bind = (hooked: SessionHooks["context"]["tools"]) => {
    const bound = Object.entries(hooked).flatMap(([name, view]) => {
      const original = given.get(view) ?? registry.get(name)
      if (original === undefined) return []
      return [
        [
          name,
          {
            definition: ToolDefinition.make({
              name,
              description: view.description,
              inputSchema: view.input,
              outputSchema: original.outputSchema,
            }),
            original,
          },
        ] as const,
      ]
    })
    return {
      definitions: bound.map(([, value]) => value.definition),
      names: new Map(bound.map(([name, value]) => [name, value.original.name])),
    }
  }
  return { payload, bind }
}

// Moved from session/http.ts:18-66; runHook now yields HookError instead of Provider.FailureError.
const httpMiddleware = (context: Provider.RequestContext): HttpMiddleware => (request, handler) =>
  Effect.gen(function* () {
    const webRequest = yield* HttpClientRequest.toWeb(request).pipe(
      Effect.mapError(() => new Provider.FailureError({ cause: "Provider request is invalid" })),
    )
    const requested = yield* runHook(
      "http.request",
      hooks.trigger("session", "http.request", { ...context, request: webRequest }),
    )
    const physicalRequest = HttpClientRequest.fromWeb(requested.request)
    // Buffer the hook-owned Web stream so Node fetch receives a sized body and does not require duplex.
    const requestBody =
      requested.request.body === null
        ? undefined
        : new Uint8Array(
            yield* Effect.tryPromise({
              try: () => requested.request.arrayBuffer(),
              catch: () => new Provider.FailureError({ cause: "Provider request body could not be read" }),
            }),
          )
    const response = yield* handler(
      requestBody === undefined
        ? physicalRequest
        : HttpClientRequest.bodyUint8Array(
            physicalRequest,
            requestBody,
            requested.request.headers.get("content-type") ?? undefined,
          ),
    )
    const body =
      response.status === 204 || response.status === 205 || response.status === 304
        ? null
        : yield* response.stream.pipe(Stream.toReadableStreamEffect())
    const responded = yield* runHook(
      "http.response",
      hooks.trigger("session", "http.response", { ...context, request: requested.request, response: new Response(body, { status: response.status, headers: response.headers }) }),
    )
    return HttpClientResponse.fromWeb(response.request, responded.response)
  })

const runHook = (stage: HookError["stage"], effect: Effect.Effect<void>) =>
  effect.pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause)
        ? Effect.interrupt
        : Effect.fail(new HookError({ stage, message: "Provider HTTP hook failed", cause })),
    ),
  )
```

Inside the Layer body, bind services once: `const hooks = yield* PluginHooks.Service`, `const policies = yield* Policy.Service`, `const bus = yield* Bus.Service`, `const toolAdmission = yield* SessionToolAdmission.Service`, `const resolver = yield* ModelResolver.Service`, `const providers = yield* Provider.Service`.

Net: `model-request.ts` (234 lines) and `http.ts` (66 lines) dissolve into `inference.ts` (~340 lines) — roughly 40 lines of true duplication (four `providerContext` literals, four middleware constructions, repeated provide ceremony) disappears, and the ordering model gains exactly one home.

## Caller migration

| Call site | Today | After |
| --- | --- | --- |
| `runner.ts:140-157` (`resolveStep`) | `SessionModelRequest.plan` + 8 `Effect.provideService` | `inference.plan({...})` + `Effect.mapError((failure) => failResolution(failure.message))` — see below |
| `runner.ts:339-377` | builds `hookContext`, triggers `context`, applies `SessionContextPolicy`, re-binds tools, builds `providerContext`, builds middleware | one `inference.stream(...)` call — see below |
| `runner.ts:379-397` | `providers.stream({...})` | `Stream.runForEach(events, ...)` over `Streamed.events` |
| `runner.ts:436-442` | `Match.valueTags` over 4 failure tags | same Match + `"SessionInference.HookError"` arm |
| `session-operations.ts:93-156` (`generate`) | plan + 8 provides, `context` trigger, policy apply, `providerContext`, middleware, `providers.stream`, chunk collector | `inference.plan` + `inference.stream` + chunk collector |
| `title.ts:112-162` | plan + 8 provides + `Effect.option`, `providerContext`, middleware, `providers.stream` | `inference.plan` + `inference.stream`, both under `Effect.option` |
| `compaction.ts:224-247` (`execute`) | `providerContext`, middleware, `providers.stream` | `inference.stream` |
| `compaction.ts:323-342`, `366-388` | two plan calls with 8 provides each | two `inference.plan` calls, bare |
| `model-request.ts`, `http.ts` | live modules | deleted (absorbed) |

**Runner** — bind once at the top of `make()` (`const inference = yield* SessionInference.Service`), then:

```ts
// resolveStep — replaces runner.ts:140-157
const request = yield* inference
  .plan({
    purpose: "assistant",
    sessionID: assistant.sessionID,
    projectID: session.projectID,
    messageID: assistant.id,
    agent: assistant.agent,
    requestedModel: assistant.model,
  })
  .pipe(Effect.mapError((failure) => failResolution(failure.message)))
```

```ts
// run loop — replaces runner.ts:331-397
const systemParts = [agent.instructions, baseline]
  .filter((text) => text.length > 0)
  .map((text) => SystemPart.make(text))
const definitions = availableTools?.definitions ?? []
const started = yield* inference
  .stream({
    plan: modelRequest,
    system: systemParts,
    messages: [...fromHistory(history), ...(cutoff ? [Message.assistant(prompt)] : [])],
    tools: definitions,
    toolChoice: cutoff ? ToolChoice.make("none") : ToolChoice.make("auto"),
  })
  .pipe(Effect.result)
if (Result.isFailure(started)) {
  const error = SessionError.Provider.make({ message: started.failure.message })
  yield* recorder.fail(error)
  return yield* new RunError({ error })
}
const { events, toolNames } = started.value
let emitted = false
const result = yield* Stream.runForEach(events, (event) => {
  if (event.type !== "step-start" && event.type !== "step-finish" && event.type !== "finish") emitted = true
  return recorder.write(event)
}).pipe(Effect.andThen(recorder.finishStream), Effect.result)
```

Tool dispatch (`runner.ts:483-489`) swaps `originalNames` for `toolNames` (`const originalName = toolNames.get(call.name)`); the failure Match (`runner.ts:436-442`) gains one arm:

```ts
"SessionInference.HookError": (failure) => SessionError.Provider.make({ message: failure.message }),
```

`Runner.make`'s requirement set drops from 18 services to 12: `Model`, `Provider`, `PluginHooks`, `Policy`, `Permission`, `ModelResolver`, `SessionToolAdmission` leave; `SessionInference.Service` enters.

**Generate** — replaces `session-operations.ts:93-157`; the public `Interface` error type (`Provider.FailureError | Provider.ContextOverflowError`, `session-operations.ts:42-48`) is preserved:

```ts
generate: Effect.fn("SessionOperations.generate")(function* (input) {
  yield* activatePlugins
  const session = yield* sessions.get(input.sessionID)
  const inference = yield* SessionInference.Service
  const asProviderFailure = (failure: SessionInference.HookError | SessionInference.RoutingError) =>
    new Provider.FailureError({ cause: failure.message })
  const plan = yield* inference
    .plan({
      purpose: "generate",
      sessionID: input.sessionID,
      projectID: session.projectID,
      agent: session.agent,
      requestedModel: session.model,
    })
    .pipe(Effect.mapError(asProviderFailure))
  const started = yield* inference
    .stream({
      plan,
      system: [],
      messages: [Message.user(input.prompt)],
      tools: [],
      toolChoice: ToolChoice.make("none"),
    })
    .pipe(Effect.mapError(asProviderFailure))
  const chunks: string[] = []
  yield* Stream.runForEach(started.events, (event) => {
    if (event.type === "text-delta") chunks.push(event.text)
    return Effect.void
  }).pipe(Effect.mapError((failure) => (failure._tag === "SessionInference.HookError" ? asProviderFailure(failure) : failure)))
  return chunks.join("")
}),
```

`SessionOperations.layer`'s requirements drop from 11 services to 4 (`Session`, `Command`, `Crypto.Crypto`, `SessionInference.Service`): `models`, `providers`, `hooks`, `policies`, `permission`, `bus`, `resolver`, `toolAdmission` bindings (`session-operations.ts:61-68`) all go.

**Title** — replaces `title.ts:112-162`; `title.ts` `make` requirements drop from 7 services to 1 (`SessionInference.Service`):

```ts
const request = yield* inference
  .plan({
    purpose: "title",
    sessionID,
    projectID: session.projectID,
    messageID: user.id,
    agent: session.agent,
    requestedModel: session.model,
  })
  .pipe(
    Effect.tapError((error) => Effect.logWarning("Session title model routing failed", { sessionID, error })),
    Effect.option,
  )
if (request._tag === "None") return
const started = yield* inference
  .stream({
    plan: request.value,
    system: [SystemPart.make(PROMPT)],
    messages: [Message.user(user.text)],
    tools: [],
    toolChoice: ToolChoice.make("none"),
  })
  .pipe(Effect.option)
if (started._tag === "None") return
const chunks: string[] = []
const result = yield* Stream.runForEach(started.value.events, (event) => {
  if (event.type === "text-delta") chunks.push(event.text)
  return Effect.void
}).pipe(Effect.result)
if (result._tag === "Failure") return
```

`system: [SystemPart.make(PROMPT)]` is wire-equivalent to today's `system: PROMPT` string — `LLMRequest.input` normalizes via `SystemPart.content`, which maps a string to exactly one `SystemPart` (`@opencode-ai/ai` `schema/messages.js`, `SystemPart.content`).

**Compaction** — `execute` takes `plan: SessionInference.Plan` instead of rebuilding context/middleware:

```ts
const execute = Effect.fn("SessionCompaction.execute")(function* (
  compaction: CompactionRunning,
  plan: SessionInference.Plan,
  prompt: string,
  recent: string,
) {
  const model = plan.resolved.selection
  const started = yield* inference
    .stream({
      plan,
      system: [],
      messages: [Message.user(prompt)],
      tools: [],
      toolChoice: ToolChoice.make("none"),
    })
    .pipe(Effect.result)
  if (started._tag === "Failure")
    return yield* failed(compaction, SessionError.Provider.make({ message: started.failure.message }))
  /* … unchanged delta collector, usage accumulation, CompactionDelta/Ended publishes … */
})
```

The two `plan` call sites (`compaction.ts:323-342`, `366-388`) lose their eight `provideService` blocks each and keep their `Effect.option` + `"Compaction model routing failed"` outcome untouched. `make` requirements drop from 9 services to 3 (`Config`, `Crypto.Crypto`, `SessionInference.Service`).

## Tests

| Existing test file | Verdict | Notes |
| --- | --- | --- |
| `packages/core/test/session/model-request.test.ts` (19 cases) | **rewrite** → `test/session/inference.test.ts` | Same cases call `SessionInference.plan` with the same `dependencies` layer. Retags only: malformed hook output (`:167-179`) and callback defects (`:663-673`) now expect `SessionInference.HookError`; routing/resolver failures expect `SessionInference.RoutingError`. Nothing else changes. |
| `packages/core/test/session/http.test.ts` (2 cases) | **delete** | Both cases are re-expressed in `inference.test.ts` against `SessionInference.stream` with a capturing `RequestExecutor` (below) — the middleware is internal now, so its old test surface stops existing. |
| `packages/core/test/session-operations.test.ts` (1 case) | **keep** | Same assertions (`:159-166`); the layer graph gains `SessionInference.layer` and the test now covers the whole ordering through `generate` unchanged. |
| `packages/core/test/session/compaction.test.ts` | **keep** | Pure unit tests of `buildPrompt`/`fromHistory`; untouched. |
| `packages/core/test/session/session-postgres.test.ts` | **keep** | Hook registrations at `:4881-4888`, `:5925` exercise the same observable behavior through the real composition. |

New cases in `test/session/inference.test.ts` (name → assertion):

1. `routes in registration order and resolves the final executable model` — moved from `model-request.test.ts:108-142` verbatim.
2. `runs model.request, context, and http.request hooks in stage order around one physical request` — shared log records `["model.request", "context", "http.request"]` in order; captured physical request carries the request-hook header; response hook header present on the returned response.
3. `skips the context hook and system policy for title and compaction purposes` — a registered `context` hook is never invoked; the provider input carries exactly the caller's `system`.
4. `normalizes context hook defects into HookError` — a `context` hook that dies makes `stream` fail with `HookError` (no defect escapes).
5. `binds hooked tools to admitted tools and drops unknown names` — hook mutates a description and adds a foreign tool; provider input has the mutated admitted tool only; `toolNames` maps the hooked name to the original name.
6. `isolates concurrent stream hook middleware` — moved from `http.test.ts:82-113`, two concurrent `stream` calls with distinct `sessionID`s keep their hook headers separate.

Representative test (case 2), driving the real implementation end to end:

```ts
it.effect("runs model.request, context, and http.request hooks in stage order around one physical request", () =>
  Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    const stages = yield* Ref.make<string[]>([])
    yield* hooks.register("session", "model.request", (event) =>
      Effect.sync(() => {
        stages.push("model.request")
        event.model = TERRA
      }),
    )
    yield* hooks.register("session", "context", (context) =>
      Effect.sync(() => {
        stages.push("context")
        context.system = [...context.system, SystemPart.make("hooked")]
      }),
    )
    yield* hooks.register("session", "http.request", (event) =>
      Effect.sync(() => {
        stages.push("http.request")
        event.request = new Request(event.request, { headers: { "x-request-hook": "applied" } })
      }),
    )
    const requests: Request[] = []
    const executor: RequestExecutor.Interface = {
      execute: (request) =>
        Effect.sync(() => {
          requests.push(HttpClientRequest.toWeb(request))
          return HttpClientResponse.fromWeb(request, new Response("ok", { status: 200 }))
        }),
    }
    const inference = yield* SessionInference.Service
    const plan = yield* inference.plan({ purpose: "assistant", sessionID, agent, requestedModel: SOL })
    const started = yield* inference.stream({
      plan,
      system: [SystemPart.make("instructions")],
      messages: [Message.user("hello")],
      tools: [],
      toolChoice: ToolChoice.make("auto"),
    })
    const response = yield* Stream.runCollect(started.events)

    expect(stages).toEqual(["model.request", "context", "http.request"])
    expect(requests[0]?.headers.get("x-request-hook")).toBe("applied")
    expect(response.some((event) => event.type === "finish")).toBe(true)
  }).pipe(Effect.provide(dependencies.pipe(Layer.provide(Provider.layerWithExecutor(executor))))),
)
```

This test is impossible to write today without a full runner graph — the ordering model had no single entry to drive.

## Preserved behavior

- `model.request` hooks see `requestedModel === model` and mutate `model`/`headers`/`baseURL` freely; the caller's requested object is never mutated (`model-request.ts:76,168-174`, `:182-191`; test `model-request.test.ts:108-165`).
- Policy evaluation order and `PolicyEnforced` stage order are unchanged: `model.request` route → escalation → `provider.request` → `provider.use` → `model.use` → endpoint (`model-request.ts:79-162`; test `:439-481`).
- Escalation honors purpose and per-Session admission (`model-request.ts:84-91`; tests `:483-545,637-661`).
- Endpoint `baseURL` overrides the hook's; headers merge hook-first then endpoint (`model-request.ts:137-145`; test `:547-602`); endpoint env headers fail closed (`:128-136`; test `:604-635`).
- Interruption inside any hook still interrupts — `hookFailure` re-raises interrupt causes (`model-request.ts:55-57`; test `:675-690`).
- Context-hook participation stays purpose-derived: `assistant`/`generate` only (`runner.ts:350`, `session-operations.ts:110` vs. their absence in `title.ts`/`compaction.ts`), and `SessionContextPolicy.apply` runs exactly when the context hook ran (`runner.ts:353-359`, `session-operations.ts:121-126`).
- Title stays silent on plan and stream failures (`title.ts:128-131,163`); compaction keeps its exact failure messages (`compaction.ts:265-275,341-342`); generate keeps `Provider.FailureError` as its error type (`session-operations.ts:42-48`).
- HTTP middleware behavior byte-for-byte: request body buffering for sized bodies (`http.ts:33-42`), null body for 204/205/304 (`:52-55`), response reconstruction and `fromWeb` (`:56-63`).
- Tool re-binding semantics: identity match, then name fallback, then drop (`runner.ts:361-366`) — moved to `admittedTools.bind` unchanged.

Deliberate divergences (the point of one error model):

1. A `context` hook defect in the runner currently **dies the run fiber** (`runner.ts:350` is uncaught); under the Module it is recorded as `SessionError.Provider` + `RunError`, mirroring how `model.request` hook defects are already normalized (`model-request.ts:55-67`). A plugin bug stops killing the assistant loop.
2. HTTP-hook failures become `HookError` instead of `Provider.FailureError` (`http.ts:14`), so they are no longer retriable by the provider retry controller (`runner.ts:408-415`): retrying a deterministic plugin bug was wasted provider traffic. The recorded message becomes the specific `"Provider HTTP hook failed"` instead of the generic provider summary.
3. `generate` stops discarding the plan-failure message (`session-operations.ts:108`); it becomes the `Provider.FailureError` cause.
4. The runner's undeclared extra `permissions` field in the `context` payload (`runner.ts:348`, not part of `SessionHooks["context"]`, `session-hooks.ts:12-21`) is dropped; the payload now matches its declared public type exactly.

## Open decisions

1. **Context-hook defect policy.** Options: (a) `HookError` — consistent, plugin bugs can't crash the loop; (b) keep today's defect for the `context` stage only. **Recommended: (a)** — it matches what `model.request` already does, and the divergence table above is otherwise asymmetric for no stated reason.
2. **Error naming.** Keep `SessionModelRequest.Failure` vs. split `RoutingError`/`HookError`. **Recommended: split** — the two failure kinds have different causes (policy vs. plugin) and different caller translations; the old type folded them because there was no second stage to compare against.
3. **Retriability of HTTP-hook failures.** Exempt `HookError` from `retryController.decide` (divergence 2) vs. keep them retriable for parity. **Recommended: exempt.**
4. **Should `stream` also publish `ExecutionModelRouted`?** No — that is conversation behavior owned by the runner (`runner.ts:319-326`); absorbing it would violate the "do not absorb unrelated conversation behavior" line.
5. **Future purposes.** A new purpose (e.g. workspace-level summarization) becomes: one entry in `contextHookPurposes` (if it should be plugin-visible) plus one caller — not five edits.

## Sequencing

1. **Introduce `session/inference.ts`** with the full Interface and Layer, implemented by moving `model-request.ts` and `http.ts` bodies in; `model-request.ts`/`http.ts` become one-line delegations so all callers compile. Move `model-request.test.ts` → `inference.test.ts` (retags) and re-express `http.test.ts` there. `bun typecheck` + `bun test` in `packages/core` green.
2. **Migrate `runner.ts`** to `inference.plan`/`inference.stream`; drop its seven now-unused service bindings; add the `HookError` Match arm and swap `originalNames` → `toolNames`.
3. **Migrate `session-operations.ts` `generate`**; shrink the Layer requirements to 4.
4. **Migrate `title.ts`**; shrink `make` requirements to 1.
5. **Migrate `compaction.ts`** (both plan sites + `execute`); shrink to 3.
6. **Delete `session/model-request.ts` and `session/http.ts`** and their delegation shims; `git diff --check`; full `bun test` in `packages/core`.
