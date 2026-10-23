import { Account } from "@bymorning/schema/account"
import { Agent } from "@bymorning/schema/agent"
import { Model } from "@bymorning/schema/model"
import { ModelError, type SessionInput } from "@bymorning/schema/plugin-model"
import { Provider as ProviderSchema } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { UserActor } from "@bymorning/schema/actor"
import { NodeCrypto } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Auth } from "@opencode-ai/ai/route/auth"
import { configure } from "@opencode-ai/ai/providers/openai-compatible"
import type { LLMEvent } from "@opencode-ai/ai/schema/events"
import { Deferred, Effect, Fiber, Layer, Ref, Stream } from "effect"
import { Actor } from "../src/actor.js"
import { Budget } from "../src/budget.js"
import { Database } from "../src/database.js"
import { Plugin } from "../src/plugin.js"
import { Provider } from "../src/provider.js"
import { Usage } from "../src/usage.js"
import { Service as UserService } from "../src/user.js"

const workspaceID = Workspace.ID.create()
const accountID = Account.ID.create()
const userID = User.ID.create()
const actor = new UserActor({ type: "user", properties: { workspaceID, accountID, userID, role: "admin" } })
const model = Model.Info.make({
  id: "model", provider: ProviderSchema.Bymorning, apiID: "upstream", name: "Test", description: "",
  status: "active", releaseDate: "2026-01-01", lastUpdated: "2026-01-01", openWeights: false,
  capabilities: { temperature: true, reasoning: false, attachment: false, tools: false, input: [], output: [] },
  variants: [], limit: { context: 1000, output: 100 }, cost: { cache: {} },
})
const ref = Model.Ref.make({ provider: model.provider, id: model.id })
const input: Provider.StreamInput = {
  context: { sessionID: Session.ID.make("00000000-0000-4000-8000-000000000001"), model: ref, requestedModel: ref, purpose: "assistant", agent: Agent.ID.make("build") },
  selection: { info: model, format: "oa-compat", package: "@opencode-ai/ai/providers/openai-compatible", options: {}, settings: {} },
  runtimeModel: configure({ provider: "bymorning", baseURL: "https://example.test/v1", auth: Auth.none }).model("upstream"),
  messages: [], authentication: (request, handler) => handler(request), http: (request, handler) => handler(request),
}

const fixture = (source: Stream.Stream<LLMEvent, Provider.FailureError>, refusal?: ModelError) =>
  Effect.gen(function* () {
    const events = yield* Ref.make<ReadonlyArray<SessionInput>>([])
    const calls = yield* Ref.make<ReadonlyArray<string>>([])
    const started = yield* Deferred.make<void>()
    const add = (value: string) => Ref.update(calls, (items) => [...items, value])
    const hooks = Layer.effect(Plugin.Hooks.Service, Effect.gen(function* () {
      const hooks = yield* Plugin.Hooks.Service
      yield* hooks.register("session", "model.invoke", (event) => Effect.gen(function* () {
        expect(Object.isFrozen(event.model)).toBe(true)
        yield* Ref.update(events, (items) => [...items, event])
        event.onClose(add("close"))
        event.onUsage(() => add("usage"))
        if (refusal) return yield* refusal
      }))
      return hooks
    })).pipe(Layer.provide(Plugin.Hooks.layer))
    const layer = Usage.sessionProviderLayer.pipe(Layer.provide(Layer.mergeAll(
      hooks,
      NodeCrypto.layer,
      Layer.succeed(Provider.Service, Provider.Service.of({
        get: () => Effect.die("unused"), list: Effect.succeed([]),
        stream: () => Stream.unwrap(add("provider").pipe(Effect.andThen(Deferred.succeed(started, undefined)), Effect.as(source))),
      })),
      // These cases never observe usage. Any persistence access is an unexpected path.
      Layer.mock(Database.Service, { use: () => Effect.die("Unexpected persistence") }),
      // These cases never exhaust or persist spend. Any Budget store access is an unexpected path.
      Layer.succeed(
        Budget.Service,
        Budget.Service.of({
          reserve: () => Effect.succeed({ settle: () => Effect.void }),
          limit: () => Effect.void,
          status: () => Effect.succeed([]),
        }),
      ),
      Layer.succeed(Actor.Binding.Service, { workspaceID, accountID, userID, role: "admin" as const }),
      Layer.mock(UserService, { select: () => Effect.succeed(actor) }),
    )))
    return { events, calls, started, layer }
  })

describe("Usage.sessionProviderLayer", () => {
  it.effect("admits every purpose with final selection and a distinct physical-attempt ID", () => Effect.gen(function* () {
    const current = yield* fixture(Stream.empty)
    yield* Effect.gen(function* () {
      const provider = yield* Provider.Service
      for (const purpose of ["assistant", "generate", "title", "compaction"] as const)
        yield* provider.stream({ ...input, context: { ...input.context, purpose } }).pipe(Stream.runDrain)
    }).pipe(Effect.provide(current.layer))
    const events = yield* Ref.get(current.events)
    expect(events.map((event) => event.purpose)).toEqual(["assistant", "generate", "title", "compaction"])
    expect(new Set(events.map((event) => event.id)).size).toBe(4)
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ workspaceID, model: ref, publicModel: "bymorning/model", stream: true })]))
    expect(yield* Ref.get(current.calls)).toEqual(["provider", "close", "provider", "close", "provider", "close", "provider", "close"])
  }))

  it.effect("maps typed refusals and closes failed admission before calling Provider", () => Effect.gen(function* () {
    for (const [reason, category] of [["rate", "rate-limit"], ["budget", "quota"], ["model", "content-filter"], ["denied", "content-filter"], ["unavailable", "internal"]] as const) {
      const current = yield* fixture(Stream.empty, new ModelError({ reason, message: "Test refusal" }))
      const error = yield* Provider.Service.use((provider) => provider.stream(input).pipe(Stream.runDrain)).pipe(Effect.provide(current.layer), Effect.flip)
      expect(error).toMatchObject({ _tag: "Provider.FailureError", category })
      expect(yield* Ref.get(current.calls)).toEqual(["close"])
    }
  }))

  it.effect("closes exactly once on upstream failure and cancellation without reporting synthetic usage", () => Effect.gen(function* () {
    const failed = yield* fixture(Stream.fail(new Provider.FailureError({ cause: "failed", category: "transport" })))
    yield* Provider.Service.use((provider) => provider.stream(input).pipe(Stream.runDrain)).pipe(Effect.provide(failed.layer), Effect.flip)
    expect(yield* Ref.get(failed.calls)).toEqual(["provider", "close"])
    const cancelled = yield* fixture(Stream.never)
    yield* Effect.gen(function* () {
      const provider = yield* Provider.Service
      const fiber = yield* provider.stream(input).pipe(Stream.runDrain, Effect.forkChild)
      yield* Deferred.await(cancelled.started)
      yield* Fiber.interrupt(fiber)
    }).pipe(Effect.provide(cancelled.layer))
    expect(yield* Ref.get(cancelled.calls)).toEqual(["provider", "close"])
  }))
})
