import { expect, it } from "@effect/vitest"
import { Effect, Exit, Scope } from "effect"
import { fromPromise } from "@bymorning/plugin/promise/adapter"
import { define } from "@bymorning/plugin/promise/plugin"
import type { WorkspaceContext } from "@bymorning/plugin/effect/plugin"
import type { GatewayInvocation } from "@bymorning/plugin/effect/model"
import type { ModelError } from "@bymorning/schema/plugin-model"
import { GatewayInput } from "@bymorning/schema/plugin-model"
import { Workspace } from "@bymorning/schema/workspace"
import { Provider } from "@bymorning/schema/provider"
import { PluginHooks } from "../src/plugin/hooks.js"

const event = GatewayInput.make({
  id: "attempt-1",
  workspaceID: Workspace.ID.make("wrk_adapter_test"),
  model: { provider: Provider.Name.make("test"), id: "model" },
  publicModel: "test/model",
  stream: true,
  protocol: "openai-chat",
})

it.effect("adapts Workspace Promise hooks without member services or activation-scoped invocation work", () => Effect.gen(function* () {
  const hooks = yield* PluginHooks.Service
  const activation = yield* Scope.make()
  const request = yield* Scope.make()
  const calls: string[] = []
  const declaration = define({
    id: "test.workspace",
    scope: "workspace",
    async setup(context) {
      expect(Object.keys(context).sort()).toEqual(["app", "catalog", "gateway", "location", "options", "session", "storage", "tool"])
      await context.gateway.hook("model.invoke", async (input) => {
        expect(Object.isFrozen(input)).toBe(true)
        expect(input.signal.aborted).toBe(false)
        input.onUsage(async () => { calls.push("usage") })
        input.onClose(async () => {
          expect(input.signal.aborted).toBe(true)
          calls.push("close")
        })
        calls.push("admitted")
      })
      return () => { calls.push("unload") }
    },
  })
  const plugin = fromPromise(declaration)
  if (plugin.scope !== "workspace") throw new Error("Workspace declaration lost its scope")
  const context = {
    app: { name: "test", version: "0", channel: "test" },
    location: { workspaceID: event.workspaceID },
    options: {},
    gateway: { hook: ((name: "model.invoke", callback: (input: GatewayInvocation) => Effect.Effect<void, ModelError, Scope.Scope>) =>
      hooks.register("gateway", name, callback)) as WorkspaceContext["gateway"]["hook"] },
    session: { hook: (() => Effect.die("Session registration is not used by this fixture")) as WorkspaceContext["session"]["hook"] },
    tool: { hook: ((name: "execute.before", callback: never) =>
      hooks.register("tool", name, callback)) as unknown as WorkspaceContext["tool"]["hook"] },
    catalog: {
      provider: { list: () => Effect.succeed([]) },
      model: { list: () => Effect.succeed([]) },
      transform: () => Effect.succeed({ dispose: Effect.void }),
      reload: () => Effect.void,
    },
    storage: {
      get: () => Effect.succeed(undefined),
      set: () => Effect.void,
      remove: () => Effect.void,
      scan: () => Effect.succeed({ entries: [] }),
    },
  }
  yield* plugin.effect(context).pipe(Scope.provide(activation))
  const invocation = yield* hooks.open({ domain: "gateway", event }).pipe(Scope.provide(request))
  expect(calls).toEqual(["admitted"])
  yield* invocation.usage({ input: 3, output: 2, reasoning: 0, cacheRead: 0, cacheWrite: 0 })
  yield* Scope.close(request, Exit.void)
  expect(calls).toEqual(["admitted", "usage", "close"])
  expect(hooks.has("gateway", "model.invoke")).toBe(true)
  yield* Scope.close(activation, Exit.void)
  expect(calls).toEqual(["admitted", "usage", "close", "unload"])
  expect(hooks.has("gateway", "model.invoke")).toBe(false)
}).pipe(Effect.provide(PluginHooks.layer)))
