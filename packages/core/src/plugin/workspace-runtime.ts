export * as WorkspaceRuntime from "./workspace-runtime.js"

import type { Workspace } from "@bymorning/schema/workspace"
import { Cause, Context, Deferred, Effect, Exit, Layer, LayerMap, Ref, type Scope } from "effect"
import type { Bus } from "../bus.js"
import type { Catalog } from "../catalog.js"
import { Config } from "../config.js"
import type { ModelResolver } from "../model-resolver.js"
import type { Usage } from "../usage.js"
import type { PluginHooks } from "./hooks.js"
import { Status, ticketFailed } from "./registry-service.js"
import type { Service as Registry } from "./registry-service.js"
import { PluginSupervisor } from "./supervisor-service.js"

export { Status } from "./registry-service.js"

/** The one Workspace activation and its effective shared authorities. */
export type Capabilities = Registry | PluginSupervisor.Service | PluginHooks.Service | Catalog.Service | Config.Service | Usage.Service | ModelResolver.Service | Bus.Service

/** Retained Workspace context supplied to a member composition. */
export class Binding extends Context.Service<Binding, Context.Context<Capabilities>>()('@bymorning/Plugin/WorkspaceBinding') {}

/** Process-owned acquisition of caller-less Plugin activations. */
export interface Interface {
  readonly acquire: (workspaceID: Workspace.ID) => Effect.Effect<Context.Context<Capabilities>, never, Scope.Scope>
}

/** Shared runtime identity, constructed explicitly by the Application. */
export class Service extends Context.Service<Service, Interface>()('@bymorning/Plugin/Workspace') {}

/**
 * Retain activations for the process lifetime, shared by member and Gateway leases.
 *
 * Each Workspace activation is built with its own memo map (`Layer.fresh`).
 * LayerMap otherwise builds every key with one shared memo map, and Layers are
 * memoized by reference: a module-level Layer in the recipe (Catalog, Model
 * Resolver, Provider registration, Hooks) would be built once for the first
 * Workspace activated and then served, with that Workspace's Credentials and
 * Config, to every other Workspace.
 */
export const layer = (recipe: (workspaceID: Workspace.ID) => Layer.Layer<Capabilities>) => Layer.effect(
  Service,
  Effect.gen(function* () {
    const map = yield* LayerMap.make((workspaceID: Workspace.ID) => Layer.fresh(recipe(workspaceID)), {
      idleTimeToLive: Infinity,
    })
    return Service.of({ acquire: (workspaceID) => map.contextEffect(workspaceID) })
  }),
)

/**
 * An explicit Workspace Plugin reload ticket.
 *
 * Config update returns this immediately while drain proceeds. `status` is the
 * latest pending, draining, active, or failed snapshot; `await` settles at
 * Active or Failed. Failures stay in inventory rather than being ignored.
 */
export interface Ticket {
  /** Latest observed reload state. */
  readonly status: Effect.Effect<Status>
  /** Wait until this attempt reaches Active or Failed. */
  readonly await: Effect.Effect<Status>
}

/**
 * Refresh Workspace Config and reload the retained Plugin activation in place.
 *
 * Reload closes admission, drains active invocation scopes, then replaces the
 * Plugin activation. Long streams delay replacement; reservations stay in the
 * invocation Scope and counters stay process-owned. The HTTP Config path
 * returns this ticket without waiting for drain. Background failure is a Failed
 * ticket with safe plugin and hook diagnostics, published to inventory.
 *
 * @param runtime - The retained Workspace activation context to refresh.
 * @returns A ticket tracking pending, draining, active, or failed reload.
 */
export const reload = Effect.fn("Plugin.Workspace.reload")(function* (
  runtime: Context.Context<Config.Service | PluginSupervisor.Service>,
) {
  const config = Context.get(runtime, Config.Service)
  const supervisor = Context.get(runtime, PluginSupervisor.Service)
  const status = yield* Ref.make<Status>(Status.Pending())
  const done = yield* Deferred.make<Status>()
  const finish = (next: Status) =>
    Ref.set(status, next).pipe(Effect.andThen(Deferred.succeed(done, next)), Effect.asVoid)
  yield* Effect.gen(function* () {
    yield* Ref.set(status, Status.Draining({ hook: "model.invoke" }))
    const refreshed = yield* Effect.exit(config.refresh)
    let refreshFailure: ReturnType<typeof ticketFailed> | undefined
    if (Exit.isFailure(refreshed)) {
      refreshFailure = ticketFailed({ cause: refreshed.cause })
      if (Cause.hasInterrupts(refreshed.cause)) return yield* finish(refreshFailure)
      yield* Effect.logWarning("failed to refresh plugin config", { ref: refreshFailure.ref, cause: refreshed.cause })
    }
    const reloaded = yield* Effect.exit(supervisor.reload)
    if (Exit.isFailure(reloaded)) {
      return yield* finish(ticketFailed({ cause: reloaded.cause, hook: "model.invoke" }))
    }
    return yield* finish(refreshFailure ?? Status.Active())
  }).pipe(
    Effect.catchCause((cause) =>
      Deferred.isDone(done).pipe(
        Effect.flatMap((completed) => (completed ? Effect.void : finish(ticketFailed({ cause, hook: "model.invoke" })))),
      ),
    ),
    Effect.forkDetach,
  )
  return {
    status: Ref.get(status),
    await: Deferred.await(done),
  } satisfies Ticket
})
