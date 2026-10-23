export * as Coordinator from "./coordinator.js"

import { Session } from "@bymorning/schema/session"
import { Deferred, Effect, Exit, Fiber, FiberSet, Scope } from "effect"

/** Why active Session ownership was interrupted. */
export type InterruptReason = "user" | "shutdown" | "superseded"

/** Runner and lifecycle operations used by one Session Coordinator. */
export interface Options<E> {
  readonly run: (sessionID: Session.ID) => Effect.Effect<void, E>
  readonly started: (sessionID: Session.ID) => Effect.Effect<void>
  readonly settled: (sessionID: Session.ID, exit: Exit.Exit<void, E>, reason?: InterruptReason) => Effect.Effect<void>
}

/** Process-local ownership controls for Session runs. */
export interface Interface<E> {
  readonly active: Effect.Effect<ReadonlySet<Session.ID>>
  readonly resume: (sessionID: Session.ID) => Effect.Effect<void, E>
  readonly wake: (sessionID: Session.ID) => Effect.Effect<void>
  readonly interrupt: (sessionID: Session.ID, reason: InterruptReason) => Effect.Effect<boolean>
  readonly awaitIdle: (sessionID: Session.ID) => Effect.Effect<void>
}

interface Execution<E> {
  readonly done: Deferred.Deferred<void, E>
  readonly ready: Deferred.Deferred<void>
  owner?: Fiber.Fiber<void>
  pendingWake: boolean
  state: "starting" | "running" | "stopping" | "settling"
  interruptionReason?: InterruptReason
}

const makeExecution = <E>(): Execution<E> => ({
  done: Deferred.makeUnsafe<void, E>(),
  ready: Deferred.makeUnsafe<void>(),
  pendingWake: false,
  state: "starting",
})

/** Construct scoped process-local ownership for Session runs. */
export const make = <E>(options: Options<E>): Effect.Effect<Interface<E>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const executions = new Map<Session.ID, Execution<E>>()
    const fork = yield* FiberSet.makeRuntime<never, void, never>()
    let closed = false

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true
        for (const execution of executions.values()) execution.pendingWake = false
      }),
    )

    const loop = (sessionID: Session.ID, execution: Execution<E>): Effect.Effect<void, E> =>
      Effect.suspend(() => options.run(sessionID)).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            if (execution.state === "stopping" || !execution.pendingWake) return Effect.void
            execution.pendingWake = false
            return Effect.yieldNow.pipe(Effect.andThen(loop(sessionID, execution)))
          }),
        ),
      )

    const start = (sessionID: Session.ID): Effect.Effect<Execution<E>> =>
      Effect.uninterruptible(
        Effect.sync(() => {
          const execution = makeExecution<E>()
          executions.set(sessionID, execution)
          execution.owner = fork(
            Effect.uninterruptibleMask((restore) =>
              Deferred.await(execution.ready).pipe(
                Effect.andThen(options.started(sessionID)),
                Effect.andThen(restore(loop(sessionID, execution))),
              ),
            ).pipe(
              Effect.withSpan("Session.Coordinator.start", { attributes: { sessionID } }),
              Effect.onExit((exit) =>
                Effect.sync(() => {
                  execution.owner = undefined
                  execution.state = "settling"
                }).pipe(
                  Effect.andThen(
                    // Settlement starts fresh I/O after an interrupted run, so it cannot execute on the interrupted owner fiber.
                    options
                      .settled(sessionID, exit, execution.interruptionReason)
                      .pipe(Effect.uninterruptible, Effect.forkChild, Effect.flatMap(Fiber.join)),
                  ),
                  Effect.ensuring(
                    Effect.suspend(() => {
                      if (!closed && execution.pendingWake) return start(sessionID).pipe(Effect.asVoid)
                      return Effect.sync(() => {
                        if (executions.get(sessionID) === execution) executions.delete(sessionID)
                      })
                    }),
                  ),
                  Effect.withSpan("Session.Coordinator.settle", { attributes: { sessionID } }),
                ),
              ),
              Effect.onExit((exit) => Deferred.done(execution.done, exit)),
              Effect.exit,
              Effect.asVoid,
            ),
          )
          execution.state = "running"
          return execution
        }).pipe(Effect.tap((execution) => Deferred.succeed(execution.ready, undefined))),
      )

    const resume = (sessionID: Session.ID): Effect.Effect<void, E> =>
      Effect.suspend(() => {
        const execution = executions.get(sessionID)
        if (execution === undefined) {
          if (closed) return Effect.void
          return start(sessionID).pipe(Effect.flatMap((execution) => Deferred.await(execution.done)))
        }
        if (execution.state === "stopping" || execution.state === "settling")
          return Deferred.await(execution.done).pipe(Effect.ignoreCause, Effect.andThen(resume(sessionID)))
        return Deferred.await(execution.done)
      })

    const wake = (sessionID: Session.ID) =>
      Effect.suspend(() => {
        if (closed) return Effect.void
        const execution = executions.get(sessionID)
        if (execution === undefined) return start(sessionID).pipe(Effect.asVoid)
        execution.pendingWake = true
        return Effect.void
      })

    const interrupt = (sessionID: Session.ID, reason: InterruptReason): Effect.Effect<boolean> =>
      Effect.sync(() => {
        const execution = executions.get(sessionID)
        if (execution === undefined || execution.state === "stopping") return false
        if (execution.state === "settling" || execution.owner === undefined) {
          execution.pendingWake = false
          return false
        }
        execution.state = "stopping"
        execution.pendingWake = false
        execution.interruptionReason = reason
        fork(Fiber.interrupt(execution.owner))
        return true
      })

    const awaitIdle = (sessionID: Session.ID): Effect.Effect<void> =>
      Effect.suspend(() => {
        const execution = executions.get(sessionID)
        if (execution === undefined) return Effect.void
        return Deferred.await(execution.done).pipe(Effect.ignoreCause, Effect.andThen(awaitIdle(sessionID)))
      })

    return {
      active: Effect.sync(
        () => new Set([...executions].filter(([, execution]) => execution.state !== "settling").map(([id]) => id)),
      ),
      resume,
      wake,
      interrupt,
      awaitIdle,
    }
  })
