import { expect, it } from "@effect/vitest"
import { Duration, Effect, Layer, Ref } from "effect"
import { TestClock } from "effect/testing"
import { TaskScheduler } from "./scheduler.js"

it.effect("keeps ticking on its interval after one tick dies", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0)
    const mocked = Layer.succeed(
      TaskScheduler.Service,
      TaskScheduler.Service.of({
        // The first tick dies as a transient failure (for example a database error surfacing through
        // `due.claim`) would; every later tick succeeds.
        tick: () =>
          Ref.updateAndGet(calls, (count) => count + 1).pipe(
            Effect.flatMap((count) => (count === 1 ? Effect.die(new Error("boom")) : Effect.void)),
          ),
      }),
    )
    yield* Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(TaskScheduler.boot(Duration.seconds(30)))
          // `Effect.repeat` runs the effect once immediately; give the forked fiber a chance to run it.
          yield* TestClock.adjust(Duration.zero)
          expect(yield* Ref.get(calls)).toBe(1)
          // Without the fix, the dying first tick would end the repeating fiber here.
          yield* TestClock.adjust(Duration.seconds(30))
          expect(yield* Ref.get(calls)).toBe(2)
          yield* TestClock.adjust(Duration.seconds(30))
          expect(yield* Ref.get(calls)).toBe(3)
        }),
      ),
      mocked,
    )
  }),
)
