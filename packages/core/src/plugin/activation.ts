export * as PluginActivation from "./activation.js"

import { Context, Effect, Layer } from "effect"
import { makeWorkspaceNode } from "@bymorning/util/effect/app-node"
import { Registry, type ActivationError } from "./registry-service.js"

/**
 * Supported activation readiness facade. It depends only on the registry's tag-only declaration
 * (upstream e0c0d5691d), so Session and ModelPolicy wait on the registry's own latch without
 * importing the registry implementation or a mutable wiring cell.
 */
export class Service extends Context.Service<Service, { readonly awaitActivation: Effect.Effect<void, ActivationError> }>()(
  "@bymorning/core/PluginActivation",
) {}

/** Supported readiness effect; it requires only Plugin's lightweight activation facade. */
export const awaitActivation = Effect.flatMap(Service, (activation) => activation.awaitActivation)

/** Canonical member activation facade delegating to the registry's `awaitActivation`. */
export const node = makeWorkspaceNode({
  service: Service,
  layer: Layer.effect(
    Service,
    Effect.map(Registry.Service, (registry) => Service.of({ awaitActivation: registry.awaitActivation })),
  ),
  deps: [Registry.node],
})
