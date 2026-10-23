import { describe, expect, it } from "@effect/vitest"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Stream } from "effect"
import { TestClock } from "effect/testing"
import { PluginUpdate } from "../src/plugin-update.js"
import { RegistryError, type Installed, type Registry } from "../src/plugin-update/registry.js"

const installed: Installed = { version: "1.0.0", revision: "1.0.0" }
const latest: Installed = { version: "2.0.0", revision: "2.0.0" }

const registry = (options: Partial<Registry> = {}) => ({
  installed: () => Effect.succeed(installed),
  latest: () => Effect.succeed(latest),
  install: () => Effect.void,
  ...options,
}) satisfies Registry

const provide = <A, E>(effect: Effect.Effect<A, E, PluginUpdate.Service>, value: Registry, enabled = true) =>
  effect.pipe(Effect.provide(Layer.provide(PluginUpdate.configured({ registry: value, enabled }), TestClock.layer())))

describe("PluginUpdate", () => {
  it.effect("caches checks for 24 hours", () => {
    let calls = 0
    return provide(Effect.gen(function* () {
      const updates = yield* PluginUpdate.Service
      expect(yield* updates.check("effect@latest")).toBe(true)
      expect(yield* updates.check("effect@latest")).toBe(true)
      expect(calls).toBe(1)
      yield* TestClock.adjust("24 hours")
      expect(yield* updates.check("effect@latest")).toBe(true)
      expect(calls).toBe(2)
    }), registry({ latest: () => Effect.sync(() => { calls++; return latest }) }))
  })

  it.effect("serializes checks and updates per target", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>()
      let active = 0
      let maximum = 0
      yield* provide(Effect.gen(function* () {
        const updates = yield* PluginUpdate.Service
        const first = yield* updates.check("effect@latest").pipe(Effect.forkChild)
        yield* Effect.yieldNow
        const second = yield* updates.update("effect@latest").pipe(Effect.forkChild)
        yield* Effect.yieldNow
        expect(maximum).toBe(1)
        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(first)
        yield* Fiber.join(second)
      }), registry({
        latest: () => Effect.gen(function* () {
          active++
          maximum = Math.max(maximum, active)
          yield* Deferred.await(gate)
          active--
          return latest
        }),
        install: () => Effect.sync(() => { active++; maximum = Math.max(maximum, active); active-- }),
      }))
    }),
  )

  it.effect("preserves the last status when a check fails", () => {
    let fail = false
    return provide(Effect.gen(function* () {
      const updates = yield* PluginUpdate.Service
      expect(yield* updates.check("effect@latest")).toBe(true)
      yield* TestClock.adjust("24 hours")
      const exit = yield* updates.check("effect@latest").pipe(Effect.exit)
      expect(Exit.isFailure(exit) && (Cause.squash(exit.cause) as { _tag: string })._tag).toBe("PluginUpdate.CheckError")
      fail = false
      expect(yield* updates.check("effect@latest")).toBe(true)
    }), registry({ latest: () => fail ? Effect.fail(new RegistryError({ target: "effect@latest" })) : Effect.sync(() => { fail = true; return latest }) }))
  })

  it.effect("emits update lifecycle and clears outdated status", () =>
    provide(Effect.gen(function* () {
      const updates = yield* PluginUpdate.Service
      const changes: PluginUpdate.Change[] = []
      const listener = yield* Stream.runForEach(updates.changes(), (change) => Effect.sync(() => changes.push(change))).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* updates.check("effect@latest")
      yield* updates.update("effect@latest")
      yield* Effect.yieldNow
      expect(changes).toEqual([
        { target: "effect@latest", outdated: true, updating: false },
        { target: "effect@latest", outdated: true, updating: true },
        { target: "effect@latest", outdated: false, updating: false },
      ])
      yield* Fiber.interrupt(listener)
    }), registry()),
  )

  it.effect("clears updating when installation fails", () =>
    provide(Effect.gen(function* () {
      const updates = yield* PluginUpdate.Service
      const changes: PluginUpdate.Change[] = []
      const listener = yield* Stream.runForEach(updates.changes(), (change) => Effect.sync(() => changes.push(change))).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      const exit = yield* updates.update("effect@latest").pipe(Effect.exit)
      expect(Exit.isFailure(exit) && (Cause.squash(exit.cause) as { _tag: string })._tag).toBe("PluginUpdate.UpdateError")
      yield* Effect.yieldNow
      expect(changes).toEqual([
        { target: "effect@latest", outdated: false, updating: true },
        { target: "effect@latest", outdated: false, updating: false },
      ])
      yield* Fiber.interrupt(listener)
    }), registry({ install: () => Effect.fail(new RegistryError({ target: "effect@latest" })) })),
  )

  it.effect("disables checks, updates, and change events", () =>
    provide(Effect.gen(function* () {
      const updates = yield* PluginUpdate.Service
      expect(yield* updates.check("effect@latest")).toBe(false)
      const exit = yield* updates.update("effect@latest").pipe(Effect.exit)
      expect(Exit.isFailure(exit) && (Cause.squash(exit.cause) as { _tag: string })._tag).toBe("PluginUpdate.DisabledError")
    }), registry({ installed: () => Effect.die("read") }), false),
  )

  it.effect("does not check immutable versions", () => {
    let calls = 0
    return provide(Effect.gen(function* () {
      const updates = yield* PluginUpdate.Service
      expect(yield* updates.check("effect@1.0.0")).toBe(false)
      expect(calls).toBe(0)
    }), registry({ installed: () => Effect.sync(() => { calls++; return installed }) }))
  })
})
