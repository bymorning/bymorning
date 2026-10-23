import { describe, expect, it } from "@effect/vitest"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { GatewayInput, ModelError } from "@bymorning/schema/plugin-model"
import { Tokens } from "@bymorning/schema/usage"
import { Workspace } from "@bymorning/schema/workspace"
import { Provider } from "@bymorning/schema/provider"
import type { ModelScope } from "@bymorning/plugin/effect/model"
import { PluginHooks } from "../src/plugin/hooks.js"

const event = GatewayInput.make({
  id: "attempt-1",
  workspaceID: Workspace.ID.make("wrk_plugin_test"),
  model: { provider: Provider.Name.make("test"), id: "model" },
  publicModel: "test/model",
  stream: true,
  protocol: "openai-chat",
})
const tokens = Tokens.make({ input: 3, output: 2, reasoning: 0, cacheRead: 0, cacheWrite: 0 })
const input = { domain: "gateway", event } as const
const denied = new ModelError({ reason: "denied", message: "Denied" })

describe("Plugin invocation", () => {
  it.effect("freezes final facts and settles once while retaining resources until request close", () => Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    const calls: string[] = []
    const activation = yield* Scope.make()
    const request = yield* Scope.make()
    let retained: ModelScope | undefined
    yield* hooks.register("gateway", "model.invoke", (invocation) => Effect.gen(function* () {
      expect(Object.isFrozen(invocation)).toBe(true)
      expect(Object.isFrozen(invocation.model)).toBe(true)
      expect(yield* Scope.Scope).not.toBe(activation)
      retained = invocation
      yield* Effect.acquireRelease(Effect.sync(() => { calls.push("reserve") }), () =>
        Effect.sync(() => { calls.push("release") }),
      )
      invocation.onUsage((value) => Effect.sync(() => {
        expect(Object.isFrozen(value)).toBe(true)
        expect(value).toEqual(tokens)
        calls.push("settle")
      }))
      invocation.onClose(Effect.sync(() => { calls.push("close") }))
    })).pipe(Scope.provide(activation))
    const invocation = yield* hooks.open(input).pipe(Scope.provide(request))
    expect(calls).toEqual(["reserve"])
    expect(() => retained?.onUsage(() => Effect.void)).toThrow("registration is closed")
    expect(() => retained?.onClose(Effect.void)).toThrow("registration is closed")
    yield* Effect.all([invocation.usage(tokens), invocation.usage(tokens)], { concurrency: "unbounded" })
    expect(calls).toEqual(["reserve", "settle"])
    yield* Scope.close(request, Exit.void)
    yield* invocation.usage(tokens)
    expect(calls).toEqual(["reserve", "settle", "release", "close"])
    expect(hooks.has("gateway", "model.invoke")).toBe(true)
    yield* Scope.close(activation, Exit.void)
    expect(hooks.has("gateway", "model.invoke")).toBe(false)
  }).pipe(Effect.provide(PluginHooks.layer)))

  it.effect("closes failed admission immediately and never runs later callbacks", () => Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    const calls: string[] = []
    yield* hooks.register("gateway", "model.invoke", (invocation) => Effect.gen(function* () {
      yield* Effect.acquireRelease(Effect.void, () => Effect.sync(() => { calls.push("release") }))
      invocation.onClose(Effect.sync(() => { calls.push("close") }))
      invocation.onUsage(() => Effect.sync(() => { calls.push("usage") }))
    }))
    yield* hooks.register("gateway", "model.invoke", () => Effect.fail(denied))
    yield* hooks.register("gateway", "model.invoke", () => Effect.sync(() => { calls.push("skipped") }))
    const request = yield* Scope.make()
    expect(yield* hooks.open(input).pipe(Scope.provide(request), Effect.flip)).toBe(denied)
    expect(calls).toEqual(["release", "close"])
    yield* Scope.close(request, Exit.void)
    expect(calls).toEqual(["release", "close"])
    yield* hooks.drain(Effect.void)
  }).pipe(Effect.scoped, Effect.provide(PluginHooks.layer)))

  it.effect("attempts every observer and reverse-order finalizer despite failures", () => Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    const calls: string[] = []
    yield* hooks.register("gateway", "model.invoke", (invocation) => Effect.sync(() => {
      invocation.onUsage(() => Effect.sync(() => { calls.push("first") }).pipe(Effect.andThen(Effect.fail(denied))))
      invocation.onUsage(() => Effect.sync(() => { calls.push("second") }).pipe(Effect.andThen(Effect.die("private"))))
      invocation.onUsage(() => Effect.sync(() => { calls.push("third") }))
      invocation.onClose(Effect.sync(() => { calls.push("close-first") }))
      invocation.onClose(Effect.sync(() => { calls.push("close-second") }).pipe(Effect.andThen(Effect.die("private"))))
      invocation.onClose(Effect.sync(() => { calls.push("close-third") }))
    }))
    const request = yield* Scope.make()
    const invocation = yield* hooks.open(input).pipe(Scope.provide(request))
    expect(yield* invocation.usage(tokens).pipe(Effect.flip)).toBe(denied)
    yield* invocation.usage(tokens)
    yield* Scope.close(request, Exit.void)
    expect(calls).toEqual(["first", "second", "third", "close-third", "close-second", "close-first"])
  }).pipe(Effect.scoped, Effect.provide(PluginHooks.layer)))

  it.effect("cancellation during admission releases immediately without fabricating usage", () => Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    const entered = yield* Deferred.make<void>()
    const calls: string[] = []
    yield* hooks.register("gateway", "model.invoke", (invocation) => Effect.gen(function* () {
      invocation.onClose(Effect.sync(() => { calls.push("closed") }))
      invocation.onUsage(() => Effect.sync(() => { calls.push("usage") }))
      yield* Effect.acquireRelease(Effect.void, () => Effect.sync(() => { calls.push("released") }))
      yield* Deferred.succeed(entered, undefined)
      return yield* Effect.never
    }))
    const request = yield* Scope.make()
    const fiber = yield* hooks.open(input).pipe(Scope.provide(request), Effect.forkChild)
    yield* Deferred.await(entered)
    yield* Fiber.interrupt(fiber)
    expect(calls).toEqual(["released", "closed"])
    yield* hooks.drain(Effect.void)
    yield* Scope.close(request, Exit.void)
    expect(calls).toEqual(["released", "closed"])
  }).pipe(Effect.scoped, Effect.provide(PluginHooks.layer)))

  it.effect("reload drains old callbacks, blocks new admission, then exposes replacement", () => Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    const calls: string[] = []
    const old = yield* Scope.make()
    yield* hooks.register("gateway", "model.invoke", (invocation) => Effect.sync(() => {
      calls.push("old")
      invocation.onClose(Effect.sync(() => { calls.push("close-old") }))
    })).pipe(Scope.provide(old))
    const first = yield* Scope.make()
    yield* hooks.open(input).pipe(Scope.provide(first))
    const replacing = yield* Deferred.make<void>()
    const replaced = yield* Deferred.make<void>()
    const next = yield* Scope.make()
    const reload = yield* hooks.drain(Effect.gen(function* () {
      calls.push("replace")
      yield* Scope.close(old, Exit.void)
      yield* Deferred.succeed(replacing, undefined)
      yield* Deferred.await(replaced)
      yield* hooks.register("gateway", "model.invoke", () => Effect.sync(() => { calls.push("new") })).pipe(Scope.provide(next))
    })).pipe(Effect.forkChild)
    // A fiber yield lets the drain enter its deterministic idle wait.
    yield* Effect.yieldNow
    expect(calls).toEqual(["old"])
    yield* Scope.close(first, Exit.void)
    yield* Deferred.await(replacing)
    const second = yield* Scope.make()
    const waiting = yield* hooks.open(input).pipe(Scope.provide(second), Effect.forkChild)
    yield* Effect.yieldNow
    expect(calls).toEqual(["old", "close-old", "replace"])
    yield* Deferred.succeed(replaced, undefined)
    yield* Fiber.join(reload)
    yield* Fiber.join(waiting)
    expect(calls).toEqual(["old", "close-old", "replace", "new"])
    yield* Scope.close(second, Exit.void)
    yield* Scope.close(next, Exit.void)
  }).pipe(Effect.scoped, Effect.provide(PluginHooks.layer)))

  it.effect("composes Workspace before member and cleans up Workspace when member refuses", () => Effect.gen(function* () {
    const workspace = yield* PluginHooks.Service
    const memberContext = yield* Layer.build(Layer.fresh(PluginHooks.layer))
    const member = Context.get(memberContext, PluginHooks.Service)
    const calls: string[] = []
    yield* workspace.register("gateway", "model.invoke", (invocation) => Effect.sync(() => {
      calls.push("workspace")
      invocation.onClose(Effect.sync(() => { calls.push("workspace-close") }))
    }))
    yield* member.register("gateway", "model.invoke", () => Effect.sync(() => { calls.push("member") }).pipe(Effect.andThen(Effect.fail(denied))))
    const hooks = PluginHooks.compose(workspace, member)
    expect(yield* hooks.open(input).pipe(Effect.flip)).toBe(denied)
    expect(calls).toEqual(["workspace", "member", "workspace-close"])
  }).pipe(Effect.scoped, Effect.provide(PluginHooks.layer)))

  it.effect("member drain does not wait for workspace-only invocations", () => Effect.gen(function* () {
    const workspace = yield* PluginHooks.Service
    const memberContext = yield* Layer.build(Layer.fresh(PluginHooks.layer))
    const member = Context.get(memberContext, PluginHooks.Service)
    const hooks = PluginHooks.compose(workspace, member)
    const entered = yield* Deferred.make<void>()
    const request = yield* Scope.make()
    yield* workspace.register("gateway", "model.invoke", () =>
      Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
    )
    yield* hooks.open(input).pipe(Scope.provide(request), Effect.forkChild)
    yield* Deferred.await(entered)
    const drained = yield* Deferred.make<void>()
    yield* hooks.drain(Deferred.succeed(drained, undefined))
    yield* Deferred.await(drained)
    yield* Scope.close(request, Exit.void)
  }).pipe(Effect.scoped, Effect.provide(PluginHooks.layer)))
})
