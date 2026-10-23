export * as TaskScheduler from "./scheduler.js"

import { Database } from "@bymorning/core/database"
import { ScheduledTask } from "@bymorning/core/scheduled-task"
import { makeGlobalNode, type GlobalNode } from "@bymorning/util/effect/app-node"
import { Context, Duration, Effect, Layer, Schedule } from "effect"
import { WorkspaceMap } from "../workspace-map.js"

/** How often the process looks for due Scheduled Tasks. */
export const Interval = Duration.seconds(30)

/** How many claimed runs start concurrently in one tick. */
export const Concurrency = 4

export interface Interface {
  /** Claim every due task and start each run inside its owner's member graph. Failures are logged, never raised. */
  readonly tick: (now: Date) => Effect.Effect<void>
}

/** Process-global Scheduled Task ticker. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/server/TaskScheduler") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const due = yield* ScheduledTask.Due.Service
    const workspaceMap = yield* WorkspaceMap.Service
    const start = Effect.fn("TaskScheduler.start")(function* (claim: ScheduledTask.Due.Claim) {
      const tasks = yield* ScheduledTask.Service
      yield* tasks.run(claim.taskID)
    })
    const tick = Effect.fn("TaskScheduler.tick")(function* (now: Date) {
      const claims = yield* due.claim(now)
      yield* Effect.forEach(
        claims,
        (claim) =>
          start(claim).pipe(
            Effect.provide(
              WorkspaceMap.Service.get(claim.owner).pipe(Layer.provide(Layer.succeed(WorkspaceMap.Service, workspaceMap))),
            ),
            Effect.catchCause((cause) =>
              Effect.logWarning("Scheduled Task run failed to start", cause).pipe(
                Effect.annotateLogs({ taskID: claim.taskID, workspaceID: claim.owner.workspaceID }),
              ),
            ),
          ),
        { concurrency: Concurrency, discard: true },
      )
    })
    return Service.of({ tick })
  }),
)

/** Explicit production boot hook; the ticker stays inert until this Layer is acquired. */
export const boot = (interval: Duration.Duration = Interval) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const scheduler = yield* Service
      yield* Effect.suspend(() => scheduler.tick(new Date())).pipe(
        // A defect from one tick (for example a transient database failure surfacing through `due.claim`)
        // must not stop the repeating schedule; log it and wait for the next interval instead.
        Effect.catchCause((cause) =>
          Effect.logError("Scheduled Task tick failed; the ticker continues on its next interval", cause),
        ),
        Effect.repeat(Schedule.spaced(interval)),
        Effect.forkScoped,
      )
    }),
  )

/** Canonical scheduler and its explicit process boot root. */
export const nodes = <E>(
  workspaces: GlobalNode<WorkspaceMap.Service, E>,
  database?: GlobalNode<Database.Service, E>,
) => {
  const due = makeGlobalNode({
    service: ScheduledTask.Due.Service,
    layer: ScheduledTask.Due.layer,
    deps: [database ?? Database.node],
  })
  const service = makeGlobalNode({ service: Service, layer, deps: [due, workspaces] })
  const bootNode = makeGlobalNode({
    name: "@bymorning/server/TaskScheduler.boot",
    layer: boot(),
    deps: [service],
  })
  return { service, boot: bootNode }
}
