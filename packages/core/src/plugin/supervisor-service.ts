export * as PluginSupervisor from "./supervisor-service.js"

import { Context, Effect, Schema } from "effect"

export class ActivationError extends Schema.TaggedError<ActivationError>()("PluginSupervisor.ActivationError", {
  cause: Schema.Defect(),
}) {}

export interface Interface {
  /** Wait for configured Plugin activation to settle. */
  readonly awaitActivation: Effect.Effect<void, import("./registry-service.js").ActivationError>
  readonly reload: Effect.Effect<void, ActivationError>
  readonly reloadAfter: <A, E, R>(mutation: Effect.Effect<A, E, R>) => Effect.Effect<A, E | ActivationError, R>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/PluginSupervisor") {}
