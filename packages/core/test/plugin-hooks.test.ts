import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Ref, Scope } from "effect"
import { Tool } from "@bymorning/schema/tool"
import { Agent } from "@bymorning/schema/agent"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import { Model } from "@bymorning/schema/model"
import * as Message from "@bymorning/schema/message"
import { User } from "@bymorning/schema/user"
import { SessionError } from "@bymorning/schema/session-error"
import { PluginHooks } from "../src/plugin/hooks.js"

const event = {
  tool: "read",
  sessionID: Session.ID.make("00000000-0000-4000-8000-000000000001"),
  agent: Agent.ID.make("build"),
  messageID: Message.ID.make("00000000-0000-4000-8000-000000000002"),
  requestedModel: { provider: Provider.Bymorning, id: "gpt-5.6-sol" },
  model: { provider: Provider.Bymorning, id: "gpt-5.6-sol" },
  id: "call_test" as Tool.CallID,
  input: {},
}

describe("PluginHooks", () => {
  it.effect("runs in registration order and removes callbacks with their scope", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const calls = yield* Ref.make<string[]>([])
      const scope = yield* Scope.make()
      yield* hooks
        .register("tool", "execute.before", () => Ref.update(calls, (items) => [...items, "first"]))
        .pipe(Scope.provide(scope))
      yield* hooks
        .register("tool", "execute.before", () => Ref.update(calls, (items) => [...items, "second"]))
        .pipe(Scope.provide(scope))

      yield* hooks.trigger("tool", "execute.before", event)
      expect(yield* Ref.get(calls)).toEqual(["first", "second"])

      yield* Scope.close(scope, Exit.void)
      yield* hooks.trigger("tool", "execute.before", event)
      expect(yield* Ref.get(calls)).toEqual(["first", "second"])
    }).pipe(Effect.provide(PluginHooks.layer)),
  )

  it.effect("stops after the first typed failure", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const scope = yield* Scope.make()
      const calls = yield* Ref.make<string[]>([])
      yield* hooks
        .register("tool", "execute.before", () =>
          Ref.update(calls, (items) => [...items, "failed"]).pipe(Effect.andThen(new Tool.Error({ message: "stop" }))),
        )
        .pipe(Scope.provide(scope))
      yield* hooks
        .register("tool", "execute.before", () => Ref.update(calls, (items) => [...items, "skipped"]))
        .pipe(Scope.provide(scope))

      yield* hooks.trigger("tool", "execute.before", event).pipe(Effect.flip)
      expect(yield* Ref.get(calls)).toEqual(["failed"])
      yield* Scope.close(scope, Exit.void)
    }).pipe(Effect.provide(PluginHooks.layer)),
  )

  it.effect("runs dedicated gateway hooks with mutable input and typed rejection", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const hooks = yield* PluginHooks.Service
        const userID = User.ID.make("usr_gateway_hook")
        const before = {
          id: Tool.CallID.make("call_gateway"),
          userID,
          tool: "search",
          input: { query: "original" },
        }
        yield* hooks.register("gateway", "tool.execute.before", (input) =>
          Effect.sync(() => {
            input.input = { query: "transformed" }
          }),
        )

        expect(yield* hooks.trigger("gateway", "tool.execute.before", before)).toEqual({
          ...before,
          input: { query: "transformed" },
        })

        const denied = new Tool.Error({ message: "gateway denied" })
        yield* hooks.register("gateway", "tool.execute.before", () => Effect.fail(denied))
        expect(yield* hooks.trigger("gateway", "tool.execute.before", before).pipe(Effect.flip)).toBe(denied)
      }),
    ).pipe(Effect.provide(PluginHooks.layer)),
  )

  it.effect("exposes prompt admission and retry decisions", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const hooks = yield* PluginHooks.Service
        yield* hooks.register("session", "prompt", (input) =>
          Effect.sync(() => {
            input.prompt.text = "prepared"
          }),
        )
        const prompt = yield* hooks.trigger("session", "prompt", {
          sessionID: event.sessionID,
          messageID: event.messageID,
          prompt: { text: "original" },
        })
        expect(prompt.prompt.text).toBe("prepared")
        yield* hooks.register("session", "retry", (input) =>
          Effect.sync(() => {
            input.decision = { retry: false }
          }),
        )
        const retry = yield* hooks.trigger("session", "retry", {
          sessionID: event.sessionID,
          agent: event.agent,
          model: event.model,
          error: SessionError.Provider.make({ message: "unavailable" }),
          attempt: 2,
          decision: { retry: true, delay: 1000 },
        })
        expect(retry.decision).toEqual({ retry: false })
      }),
    ).pipe(Effect.provide(PluginHooks.layer)),
  )

  it.effect("exposes the mutable shell boundary and removes it with scope", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const scope = yield* Scope.make()
      yield* hooks
        .register("shell", "create.before", (input) =>
          Effect.sync(() => {
            input.command = `wrapped ${input.command}`
            input.env.PLUGIN = "active"
          }),
        )
        .pipe(Scope.provide(scope))

      const input = { command: "echo", cwd: "/tmp", timeout: 1000, shell: "/bin/sh", env: {} }
      expect(yield* hooks.trigger("shell", "create.before", input)).toEqual({
        ...input,
        command: "wrapped echo",
        env: { PLUGIN: "active" },
      })

      yield* Scope.close(scope, Exit.void)
      const after = { command: "echo", cwd: "/tmp", timeout: 1000, shell: "/bin/sh", env: {} }
      expect(yield* hooks.trigger("shell", "create.before", after)).toEqual(after)
    }).pipe(Effect.provide(PluginHooks.layer)),
  )

  it.effect("matches provider-scoped hooks against the evolving effective model", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const hooks = yield* PluginHooks.Service
        const providerA = Provider.Name.make("provider-a")
        const providerB = Provider.Name.make("provider-b")
        const requestedModel = Model.Ref.make({ provider: providerA, id: "model-a" })
        const modelB = Model.Ref.make({ provider: providerB, id: "model-b" })
        const calls = yield* Ref.make<string[]>([])
        yield* hooks.register(
          "session",
          "model.request",
          (input) =>
            Effect.sync(() => {
              input.model = modelB
            }),
          { providerID: providerA },
        )
        yield* hooks.register(
          "session",
          "model.request",
          () => Ref.update(calls, (items) => [...items, "provider-b"]),
          { providerID: providerB },
        )
        const result = yield* hooks.trigger("session", "model.request", {
          purpose: "assistant",
          sessionID: event.sessionID,
          agent: event.agent,
          requestedModel,
          model: { ...requestedModel },
          headers: {},
        })
        expect(result.model).toEqual(modelB)
        expect(yield* Ref.get(calls)).toEqual(["provider-b"])
      }),
    ).pipe(Effect.provide(PluginHooks.layer)),
  )
})
