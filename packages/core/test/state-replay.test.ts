import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Scope } from "effect"
import { State } from "../src/state.js"

describe("State replay", () => {
  it.effect("replays scoped transforms into a fresh value on every invalidation", () =>
    Effect.gen(function* () {
      const state = State.create({
        initial: () => ({ values: [] as string[] }),
        editor: (value) => value,
      })
      const scope = yield* Scope.make()
      yield* state.transform((editor) => editor.values.push("one")).pipe(Effect.provideService(Scope.Scope, scope))
      const first = state.get()
      yield* state.reload()
      const second = state.get()
      expect(second).not.toBe(first)
      expect(first.values).toEqual(["one"])
      expect(second.values).toEqual(["one"])
      yield* Scope.close(scope, Exit.void)
      expect(state.get().values).toEqual([])
    }),
  )
})
