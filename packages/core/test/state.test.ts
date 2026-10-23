import { describe, expect, it } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber, Ref, Scope } from "effect"
import { State } from "../src/state.js"

describe("State persistence coordination", () => {
  it.effect("serializes activation and rebase and commits a batch once", () =>
    Effect.gen(function* () {
      const coordinator = State.makeCoordinator()
      const commits = yield* Ref.make<number[]>([])
      let base = 1
      const state = State.create<{ value: number }, { value: number }>({
        initial: () => ({ value: base }),
        editor: (value) => value,
        coordinator,
        notify: (value) => Ref.update(commits, (values) => [...values, value.value]),
      })
      const scope = yield* Scope.make()

      yield* State.batch(
        coordinator,
        Effect.gen(function* () {
          yield* state.transform((editor) => {
            editor.value += 1
          }).pipe(Effect.provideService(Scope.Scope, scope))
          yield* state.transform((editor) => {
            editor.value += 1
          }).pipe(Effect.provideService(Scope.Scope, scope))
        }),
      )

      expect(state.get().value).toBe(3)
      expect(yield* Ref.get(commits)).toEqual([3])
      yield* state.rebase(Effect.succeed(5), (next) => {
        base = next
        return true
      })
      expect(state.get().value).toBe(7)
      yield* Scope.close(scope, Exit.void)
    }),
  )

  it.effect("does not publish rejected, unchanged, or interrupted loads", () =>
    Effect.gen(function* () {
      let base = 1
      const state = State.create({
        initial: () => ({ value: base }),
        editor: (value) => value,
        seal: (value) => Object.freeze(value),
      })

      yield* state.rebase(Effect.succeed(2), () => false)
      expect(state.get().value).toBe(1)

      yield* state.rebase(Effect.succeed(1), (next) => {
        if (next === base) return false
        base = next
        return true
      })
      expect(state.get().value).toBe(1)
      expect(Object.isFrozen(state.get())).toBe(false)

      yield* state.rebase(Effect.succeed(2), (next) => {
        base = next
        return true
      })
      expect(Object.isFrozen(state.get())).toBe(true)

      const waiting = yield* Deferred.make<number>()
      const fiber = yield* state.rebase(Deferred.await(waiting), (next) => {
        base = next
        return true
      }).pipe(Effect.forkChild)
      yield* Fiber.interrupt(fiber)
      expect(state.get().value).toBe(2)
      expect(base).toBe(2)
    }),
  )

  it.effect("rebuilds only on read and retains the previous value after a throwing transform", () =>
    Effect.gen(function* () {
      let fail = false
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        editor: (value) => value,
      })
      const scope = yield* Scope.make()
      yield* state.transform((editor) => {
        if (fail) throw new Error("broken")
        editor.values.push("present")
      }).pipe(Effect.provideService(Scope.Scope, scope))
      expect(state.get().values).toEqual(["present"])
      fail = true
      yield* state.reload().pipe(Effect.exit)
      expect(() => state.get()).toThrow("broken")
      fail = false
      expect(state.get().values).toEqual(["present"])
    }),
  )

  it.effect("seals rebuilt values and shutdown closes changed State without notifying", () =>
    Effect.gen(function* () {
      const notifications = yield* Ref.make(0)
      const state = State.create<{ value: number }, { value: number }>({
        initial: () => ({ value: 1 }),
        editor: (value) => value,
        seal: Object.freeze,
        notify: () => Ref.update(notifications, (count) => count + 1),
      })
      const scope = yield* Scope.make()
      yield* State.shutdown(
        state.transform((editor) => {
          editor.value = 2
        }).pipe(Effect.provideService(Scope.Scope, scope)),
      )
      expect(state.get()).toEqual({ value: 1 })
      expect(yield* Ref.get(notifications)).toBe(0)
      yield* state.reload()
      expect(yield* Ref.get(notifications)).toBe(0)
    }),
  )
})
