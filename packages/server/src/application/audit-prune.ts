export * as AuditPrune from "./audit-prune.js"

import { Audit } from "@bymorning/core/audit"
import { makeGlobalNode, type GlobalNode } from "@bymorning/util/effect/app-node"
import { Duration, Effect, Layer, Schedule } from "effect"

/** How often the process prunes Audit Entries past their retention. */
export const Interval = Duration.hours(24)

/**
 * Explicit production boot hook; the pruner stays inert until this node is
 * acquired. It runs once at boot and then on the interval, logging a failure
 * and waiting for the next tick rather than stopping.
 */
export const boot = <E>(audit: GlobalNode<Audit.Service, E>) =>
  makeGlobalNode({
    name: "@bymorning/server/Audit.prune",
    layer: Layer.effectDiscard(
      Effect.gen(function* () {
        const service = yield* Audit.Service
        yield* Effect.suspend(() => service.prune()).pipe(
          Effect.catchCause((cause) =>
            Effect.logError("Audit retention prune failed; the next interval retries", cause),
          ),
          Effect.repeat(Schedule.spaced(Interval)),
          Effect.forkScoped,
        )
      }),
    ),
    deps: [audit],
  })
