import { describe, expect, it } from "@effect/vitest"
import { Session } from "@bymorning/schema/session"
import { Cause, Deferred, Effect, Exit, Fiber, Ref, Scope } from "effect"
import { Coordinator } from "../../src/session/coordinator.js"

const sessionID = Session.ID.make("00000000-0000-4000-8000-000000000601")
const otherSessionID = Session.ID.make("00000000-0000-4000-8000-000000000602")

class TestRunError {
  readonly _tag = "TestRunError"
}

describe("Session coordinator", () => {
  it.effect("snapshots an empty detached active set", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const release = yield* Deferred.make<void>()
        const coordinator = yield* Coordinator.make({
          run: () => Deferred.await(release),
          started: () => Effect.void,
          settled: () => Effect.void,
        })
        const initial = yield* coordinator.active
        expect(initial).toEqual(new Set())
        yield* coordinator.wake(sessionID)
        expect(initial).toEqual(new Set())
        expect(yield* coordinator.active).toEqual(new Set([sessionID]))
        yield* Deferred.succeed(release, undefined)
      }),
    ),
  )

  it.effect("installs membership before the started hook", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const observed = yield* Deferred.make<ReadonlySet<Session.ID>>()
        const release = yield* Deferred.make<void>()
        const ready = yield* Deferred.make<Coordinator.Interface<never>>()
        const coordinator = yield* Coordinator.make({
          run: () => Deferred.await(release),
          started: () =>
            Deferred.await(ready).pipe(
              Effect.flatMap((coordinator) => coordinator.active),
              Effect.flatMap((active) => Deferred.succeed(observed, active)),
            ),
          settled: () => Effect.void,
        })
        yield* Deferred.succeed(ready, coordinator)
        yield* coordinator.wake(sessionID)
        expect(yield* Deferred.await(observed)).toEqual(new Set([sessionID]))
        yield* Deferred.succeed(release, undefined)
      }),
    ),
  )

  it.effect("coalesces wakes into one busy period", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const first = yield* Deferred.make<void>()
        const second = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        const runs = yield* Ref.make(0)
        const starts = yield* Ref.make(0)
        const settlements = yield* Ref.make(0)
        const coordinator = yield* Coordinator.make({
          run: () =>
            Ref.getAndUpdate(runs, (count) => count + 1).pipe(
              Effect.flatMap((index) =>
                index === 0
                  ? Deferred.await(first)
                  : Deferred.succeed(secondStarted, undefined).pipe(Effect.andThen(Deferred.await(second))),
              ),
            ),
          started: () => Ref.update(starts, (count) => count + 1),
          settled: () => Ref.update(settlements, (count) => count + 1),
        })
        yield* coordinator.wake(sessionID)
        yield* coordinator.wake(sessionID)
        yield* coordinator.wake(sessionID)
        yield* Deferred.succeed(first, undefined)
        yield* Deferred.await(secondStarted)
        yield* Deferred.succeed(second, undefined)
        yield* coordinator.awaitIdle(sessionID)
        expect(yield* Ref.get(runs)).toBe(2)
        expect(yield* Ref.get(starts)).toBe(1)
        expect(yield* Ref.get(settlements)).toBe(1)
      }),
    ),
  )

  it.effect("removes membership before successful settlement", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const run = yield* Deferred.make<void>()
        const cleaned = yield* Deferred.make<void>()
        const observed = yield* Deferred.make<ReadonlySet<Session.ID>>()
        const ready = yield* Deferred.make<Coordinator.Interface<never>>()
        const coordinator = yield* Coordinator.make({
          run: () => Deferred.await(run).pipe(Effect.ensuring(Deferred.succeed(cleaned, undefined))),
          started: () => Effect.void,
          settled: () =>
            Effect.all([Deferred.await(cleaned), Deferred.await(ready)]).pipe(
              Effect.flatMap(([, coordinator]) => coordinator.active),
              Effect.flatMap((active) => Deferred.succeed(observed, active)),
            ),
        })
        yield* Deferred.succeed(ready, coordinator)
        yield* coordinator.wake(sessionID)
        yield* Deferred.succeed(run, undefined)
        expect(yield* Deferred.await(observed)).toEqual(new Set())
      }),
    ),
  )

  it.effect("preserves typed runner failure", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const settledExit = yield* Deferred.make<Exit.Exit<void, TestRunError>>()
        const error = new TestRunError()
        const coordinator = yield* Coordinator.make({
          run: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.fail(error))),
          started: () => Effect.void,
          settled: (_, exit) => Deferred.succeed(settledExit, exit),
        })
        yield* coordinator.wake(sessionID)
        yield* Deferred.await(started)
        const resumed = yield* coordinator.resume(sessionID).pipe(Effect.flip)
        expect(resumed).toBe(error)
        const exit = yield* Deferred.await(settledExit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBe(error)
      }),
    ),
  )

  it.effect("keeps interrupted ownership active through cleanup", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const running = yield* Deferred.make<void>()
        const cleaning = yield* Deferred.make<void>()
        const cleanup = yield* Deferred.make<void>()
        const observed = yield* Deferred.make<{ active: ReadonlySet<Session.ID>; reason?: Coordinator.InterruptReason }>()
        const ready = yield* Deferred.make<Coordinator.Interface<never>>()
        const coordinator = yield* Coordinator.make({
          run: () =>
            Deferred.succeed(running, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.ensuring(Deferred.succeed(cleaning, undefined).pipe(Effect.andThen(Deferred.await(cleanup)))),
            ),
          started: () => Effect.void,
          settled: (_, __, reason) =>
            Deferred.await(ready).pipe(
              Effect.flatMap((coordinator) => coordinator.active),
              Effect.flatMap((active) => Deferred.succeed(observed, { active, reason })),
            ),
        })
        yield* Deferred.succeed(ready, coordinator)
        yield* coordinator.wake(sessionID)
        yield* Deferred.await(running)
        expect(yield* coordinator.interrupt(sessionID, "user")).toBe(true)
        yield* Deferred.await(cleaning)
        expect(yield* coordinator.active).toEqual(new Set([sessionID]))
        yield* Deferred.succeed(cleanup, undefined)
        expect(yield* Deferred.await(observed)).toEqual({ active: new Set(), reason: "user" })
      }),
    ),
  )

  it.effect("completes suspended settlement after interrupting the owner", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const running = yield* Deferred.make<void>()
        const settling = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const settled = yield* Deferred.make<void>()
        const coordinator = yield* Coordinator.make({
          run: () => Deferred.succeed(running, undefined).pipe(Effect.andThen(Effect.never)),
          started: () => Effect.void,
          settled: () =>
            Deferred.succeed(settling, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(Deferred.succeed(settled, undefined)),
            ),
        })
        yield* coordinator.wake(sessionID)
        yield* Deferred.await(running)
        expect(yield* coordinator.interrupt(sessionID, "user")).toBe(true)
        yield* Deferred.await(settling)
        yield* Deferred.succeed(release, undefined)
        yield* Deferred.await(settled)
        yield* coordinator.awaitIdle(sessionID)
      }),
    ),
  )

  it.effect("starts a late wake only after terminal settlement", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstRun = yield* Deferred.make<void>()
        const settling = yield* Deferred.make<void>()
        const settleRelease = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        const secondRun = yield* Deferred.make<void>()
        const starts = yield* Ref.make(0)
        const order = yield* Ref.make<ReadonlyArray<string>>([])
        const coordinator = yield* Coordinator.make({
          run: () => Ref.get(starts).pipe(Effect.flatMap((count) => Deferred.await(count === 1 ? firstRun : secondRun))),
          started: () =>
            Ref.updateAndGet(starts, (count) => count + 1).pipe(
              Effect.flatMap((count) =>
                Ref.update(order, (items) => [...items, `start-${count}`]).pipe(
                  Effect.andThen(count === 2 ? Deferred.succeed(secondStarted, undefined) : Effect.void),
                ),
              ),
            ),
          settled: () =>
            Ref.get(starts).pipe(
              Effect.flatMap((count) =>
                count === 1
                  ? Deferred.succeed(settling, undefined).pipe(
                      Effect.andThen(Deferred.await(settleRelease)),
                      Effect.andThen(Ref.update(order, (items) => [...items, "settled-1"])),
                    )
                  : Effect.void,
              ),
            ),
        })
        yield* coordinator.wake(sessionID)
        yield* Deferred.succeed(firstRun, undefined)
        yield* Deferred.await(settling)
        expect(yield* coordinator.active).toEqual(new Set())
        yield* coordinator.wake(sessionID)
        expect(yield* Deferred.isDone(secondStarted)).toBe(false)
        yield* Deferred.succeed(settleRelease, undefined)
        yield* Deferred.await(secondStarted)
        expect(yield* Ref.get(order)).toEqual(["start-1", "settled-1", "start-2"])
        yield* Deferred.succeed(secondRun, undefined)
      }),
    ),
  )

  it.effect("runs different Session IDs concurrently", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Ref.make(0)
        const both = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const coordinator = yield* Coordinator.make({
          run: () => Deferred.await(release),
          started: () =>
            Ref.updateAndGet(started, (count) => count + 1).pipe(
              Effect.flatMap((count) => (count === 2 ? Deferred.succeed(both, undefined) : Effect.void)),
            ),
          settled: () => Effect.void,
        })
        yield* coordinator.wake(sessionID)
        yield* coordinator.wake(otherSessionID)
        yield* Deferred.await(both)
        expect(yield* coordinator.active).toEqual(new Set([sessionID, otherSessionID]))
        yield* Deferred.succeed(release, undefined)
      }),
    ),
  )

  it.effect("joins a wake-started execution through resume", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const running = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const runs = yield* Ref.make(0)
        const coordinator = yield* Coordinator.make({
          run: () =>
            Ref.update(runs, (count) => count + 1).pipe(
              Effect.andThen(Deferred.succeed(running, undefined)),
              Effect.andThen(Deferred.await(release)),
            ),
          started: () => Effect.void,
          settled: () => Effect.void,
        })
        yield* coordinator.wake(sessionID)
        yield* Deferred.await(running)
        const joined = yield* coordinator.resume(sessionID).pipe(Effect.forkChild({ startImmediately: true }))
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(joined)
        expect(yield* Ref.get(runs)).toBe(1)
      }),
    ),
  )

  it.effect("clears wakes recorded before interruption", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const running = yield* Deferred.make<void>()
        const cleaning = yield* Deferred.make<void>()
        const cleanup = yield* Deferred.make<void>()
        const runs = yield* Ref.make(0)
        const coordinator = yield* Coordinator.make({
          run: () =>
            Ref.update(runs, (count) => count + 1).pipe(
              Effect.andThen(Deferred.succeed(running, undefined)),
              Effect.andThen(Effect.never),
              Effect.ensuring(
                Deferred.succeed(cleaning, undefined).pipe(Effect.andThen(Deferred.await(cleanup))),
              ),
            ),
          started: () => Effect.void,
          settled: () => Effect.void,
        })
        yield* coordinator.wake(sessionID)
        yield* Deferred.await(running)
        yield* coordinator.wake(sessionID)
        expect(yield* coordinator.interrupt(sessionID, "user")).toBe(true)
        yield* Deferred.await(cleaning)
        yield* Deferred.succeed(cleanup, undefined)
        yield* coordinator.awaitIdle(sessionID)
        expect(yield* Ref.get(runs)).toBe(1)
        expect(yield* coordinator.active).toEqual(new Set())
      }),
    ),
  )

  it.effect("preserves wakes received during interruption cleanup", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const running = yield* Deferred.make<void>()
        const cleaning = yield* Deferred.make<void>()
        const cleanup = yield* Deferred.make<void>()
        const successor = yield* Deferred.make<void>()
        const successorRelease = yield* Deferred.make<void>()
        const runs = yield* Ref.make(0)
        const coordinator = yield* Coordinator.make({
          run: () =>
            Ref.getAndUpdate(runs, (count) => count + 1).pipe(
              Effect.flatMap((index) =>
                index === 0
                  ? Deferred.succeed(running, undefined).pipe(
                      Effect.andThen(Effect.never),
                      Effect.ensuring(Deferred.succeed(cleaning, undefined).pipe(Effect.andThen(Deferred.await(cleanup)))),
                    )
                  : Deferred.succeed(successor, undefined).pipe(Effect.andThen(Deferred.await(successorRelease))),
              ),
            ),
          started: () => Effect.void,
          settled: () => Effect.void,
        })
        yield* coordinator.wake(sessionID)
        yield* Deferred.await(running)
        expect(yield* coordinator.interrupt(sessionID, "user")).toBe(true)
        yield* Deferred.await(cleaning)
        yield* coordinator.wake(sessionID)
        yield* Deferred.succeed(cleanup, undefined)
        yield* Deferred.await(successor)
        expect(yield* Ref.get(runs)).toBe(2)
        yield* Deferred.succeed(successorRelease, undefined)
      }),
    ),
  )

  it.effect("passes the exact runner defect to settlement", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const defect = new Error("run defect")
        const seen = yield* Deferred.make<Exit.Exit<void>>()
        const coordinator = yield* Coordinator.make({
          run: () => Effect.die(defect),
          started: () => Effect.void,
          settled: (_, exit) => Deferred.succeed(seen, exit),
        })
        const exit = yield* coordinator.resume(sessionID).pipe(Effect.exit)
        const settledExit = yield* Deferred.await(seen)
        expect(Exit.isFailure(settledExit)).toBe(true)
        if (Exit.isFailure(settledExit)) expect(Cause.squash(settledExit.cause)).toBe(defect)
        expect(Exit.isFailure(exit)).toBe(true)
        expect(yield* coordinator.active).toEqual(new Set())
      }),
    ),
  )

  it.effect("propagates a settlement defect to a joining resume", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const running = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const settlementDefect = new Error("settlement defect")
        const coordinator = yield* Coordinator.make({
          run: () => Deferred.succeed(running, undefined).pipe(Effect.andThen(Deferred.await(release))),
          started: () => Effect.void,
          settled: () => Effect.die(settlementDefect),
        })
        yield* coordinator.wake(sessionID)
        yield* Deferred.await(running)
        const joined = yield* coordinator.resume(sessionID).pipe(
          Effect.exit,
          Effect.forkChild({ startImmediately: true }),
        )
        yield* Deferred.succeed(release, undefined)
        const exit = yield* Fiber.join(joined)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBe(settlementDefect)
        expect(yield* coordinator.active).toEqual(new Set())
      }),
    ),
  )

  it.effect("skips the runner after a started hook defect and settles with the exact defect", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const startedDefect = new Error("started defect")
        const settled = yield* Deferred.make<Exit.Exit<void>>()
        const runs = yield* Ref.make(0)
        const coordinator = yield* Coordinator.make({
          run: () => Ref.update(runs, (count) => count + 1),
          started: () => Effect.die(startedDefect),
          settled: (_, exit) => Deferred.succeed(settled, exit),
        })
        const exit = yield* coordinator.resume(sessionID).pipe(Effect.exit)
        const settledExit = yield* Deferred.await(settled)
        expect(yield* Ref.get(runs)).toBe(0)
        expect(Exit.isFailure(settledExit)).toBe(true)
        if (Exit.isFailure(settledExit)) expect(Cause.squash(settledExit.cause)).toBe(startedDefect)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBe(startedDefect)
      }),
    ),
  )

  it.effect("does not attach a late interrupt reason during settlement", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const running = yield* Deferred.make<void>()
        const settling = yield* Deferred.make<void>()
        const releaseSettlement = yield* Deferred.make<void>()
        const reasonSeen = yield* Deferred.make<Coordinator.InterruptReason | undefined>()
        const runs = yield* Ref.make(0)
        const coordinator = yield* Coordinator.make({
          run: () =>
            Ref.update(runs, (count) => count + 1).pipe(
              Effect.andThen(Deferred.succeed(running, undefined)),
              Effect.andThen(Effect.never),
            ),
          started: () => Effect.void,
          settled: (_, __, reason) =>
            Deferred.succeed(reasonSeen, reason).pipe(
              Effect.andThen(Deferred.succeed(settling, undefined)),
              Effect.andThen(Deferred.await(releaseSettlement)),
            ),
        })
        yield* coordinator.wake(sessionID)
        yield* Deferred.await(running)
        expect(yield* coordinator.interrupt(sessionID, "user")).toBe(true)
        yield* Deferred.await(settling)
        yield* coordinator.wake(sessionID)
        expect(yield* coordinator.interrupt(sessionID, "shutdown")).toBe(false)
        yield* Deferred.succeed(releaseSettlement, undefined)
        yield* coordinator.awaitIdle(sessionID)
        expect(yield* Deferred.await(reasonSeen)).toBe("user")
        expect(yield* Ref.get(runs)).toBe(1)
      }),
    ),
  )

  it.effect("resume during settlement starts or joins the successor and awaitIdle spans it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstRun = yield* Deferred.make<void>()
        const settling = yield* Deferred.make<void>()
        const releaseSettlement = yield* Deferred.make<void>()
        const secondRunning = yield* Deferred.make<void>()
        const secondRun = yield* Deferred.make<void>()
        const idleDone = yield* Deferred.make<void>()
        const runs = yield* Ref.make(0)
        const coordinator = yield* Coordinator.make({
          run: () =>
            Ref.getAndUpdate(runs, (count) => count + 1).pipe(
              Effect.flatMap((index) =>
                index === 0
                  ? Deferred.await(firstRun)
                  : Deferred.succeed(secondRunning, undefined).pipe(Effect.andThen(Deferred.await(secondRun))),
              ),
            ),
          started: () => Effect.void,
          settled: () =>
            Ref.get(runs).pipe(
              Effect.flatMap((count) =>
                count === 1
                  ? Deferred.succeed(settling, undefined).pipe(Effect.andThen(Deferred.await(releaseSettlement)))
                  : Effect.void,
              ),
            ),
        })
        yield* coordinator.wake(sessionID)
        yield* Deferred.succeed(firstRun, undefined)
        yield* Deferred.await(settling)
        const resumed = yield* coordinator.resume(sessionID).pipe(Effect.forkChild)
        const idle = yield* coordinator.awaitIdle(sessionID).pipe(
          Effect.andThen(Deferred.succeed(idleDone, undefined)),
          Effect.forkChild,
        )
        yield* Deferred.succeed(releaseSettlement, undefined)
        yield* Deferred.await(secondRunning)
        expect(yield* Deferred.isDone(secondRun)).toBe(false)
        expect(yield* Deferred.isDone(idleDone)).toBe(false)
        yield* Deferred.succeed(secondRun, undefined)
        yield* Fiber.join(resumed)
        yield* Fiber.join(idle)
        expect(yield* Ref.get(runs)).toBe(2)
      }),
    ),
  )

  it.effect("does not cancel the owner when a joining waiter is interrupted", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const running = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const coordinator = yield* Coordinator.make({
          run: () => Deferred.succeed(running, undefined).pipe(Effect.andThen(Deferred.await(release))),
          started: () => Effect.void,
          settled: () => Effect.void,
        })
        yield* coordinator.wake(sessionID)
        yield* Deferred.await(running)
        const cancelled = yield* coordinator.resume(sessionID).pipe(Effect.forkChild)
        const remaining = yield* coordinator.resume(sessionID).pipe(Effect.forkChild)
        yield* Fiber.interrupt(cancelled)
        expect(yield* coordinator.active).toEqual(new Set([sessionID]))
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(remaining)
      }),
    ),
  )

  it.effect("invokes start before immediate interruption settles", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const settled = yield* Deferred.make<void>()
        const order = yield* Ref.make<ReadonlyArray<string>>([])
        const coordinator = yield* Coordinator.make({
          run: () => Effect.never,
          started: () =>
            Ref.update(order, (items) => [...items, "started"]).pipe(
              Effect.andThen(Deferred.succeed(started, undefined)),
            ),
          settled: () =>
            Ref.update(order, (items) => [...items, "settled"]).pipe(
              Effect.andThen(Deferred.succeed(settled, undefined)),
            ),
        })
        yield* coordinator.wake(sessionID)
        expect(yield* coordinator.interrupt(sessionID, "user")).toBe(true)
        yield* Deferred.await(started)
        yield* Deferred.await(settled)
        expect(yield* Ref.get(order)).toEqual(["started", "settled"])
      }),
    ),
  )

  it.effect("closes active ownership with the coordinator scope", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const running = yield* Deferred.make<void>()
      const settled = yield* Deferred.make<{ exit: Exit.Exit<void>; reason?: Coordinator.InterruptReason }>()
      const starts = yield* Ref.make(0)
      const coordinator = yield* Coordinator.make({
        run: () => Deferred.succeed(running, undefined).pipe(Effect.andThen(Effect.never)),
        started: () => Ref.update(starts, (count) => count + 1),
        settled: (_, exit, reason) => Deferred.succeed(settled, { exit, reason }),
      }).pipe(Effect.provideService(Scope.Scope, scope))
      yield* coordinator.wake(sessionID)
      yield* Deferred.await(running)
      yield* coordinator.wake(sessionID)
      yield* Scope.close(scope, Exit.void)
      const result = yield* Deferred.await(settled)
      expect(Exit.isFailure(result.exit)).toBe(true)
      expect(result.reason).toBeUndefined()
      expect(yield* Ref.get(starts)).toBe(1)
      expect(yield* coordinator.active).toEqual(new Set())
    }),
  )
})
