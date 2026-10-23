export * as ModelPolicy from "./model-policy.js"

import { Context, Effect, Latch, Layer, Stream } from "effect"
import { Bus } from "./bus.js"
import { Config } from "./config.js"
import { Integration } from "./integration.js"
import { Catalog } from "./catalog.js"
import { makeWorkspaceNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"
import { Plugin } from "./plugin.js"

export interface Interface {
  readonly flush: Effect.Effect<void, import("./plugin/registry-service.js").ActivationError>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/core/ModelPolicy") {}

/** Workspace-owned reconciliation of connected Providers into persisted model policy. */
export const layer = (activation: Effect.Effect<void, import("./plugin/registry-service.js").ActivationError>) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const config = yield* Config.Service
      const catalog = yield* Catalog.Service
      const reconcilePolicy = config.modelPolicy.reconcile
      if (reconcilePolicy === undefined)
        return yield* Effect.die(new Error("Config model policy reconciliation is unavailable"))
      const reconcile = Effect.fn("ModelPolicy.reconcile")(function* () {
        const definitions = yield* catalog.model.all()
        for (const provider of yield* catalog.provider.available()) {
          yield* reconcilePolicy(
            provider.name,
            definitions.filter((model) => model.provider === provider.name),
          )
        }
      })
      const changes = Stream.merge(
        yield* bus.subscribe(Integration.Event.Updated),
        yield* bus.subscribe(Integration.Event.ConnectionUpdated),
      )
      const ready = yield* Latch.make()
      yield* changes.pipe(
        Stream.runForEach(() =>
          ready.await.pipe(
            Effect.andThen(
              reconcile().pipe(
                Effect.catchCause((cause) => Effect.logError("model policy reconciliation failed", { cause })),
              ),
            ),
          ),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      return Service.of({
        flush: activation.pipe(
          Effect.andThen(
            reconcile().pipe(
              Effect.catchCause((cause) => Effect.logError("initial model policy reconciliation failed", { cause })),
            ),
          ),
          Effect.andThen(ready.open),
          Effect.asVoid,
        ),
      })
    }),
  )

/** Canonical model-policy reconciliation node with explicit plugin activation. */
export const node = makeWorkspaceNode({
  service: Service,
  layer: Layer.unwrap(Effect.map(Plugin.Activation.Service, (activation) => layer(activation.awaitActivation))),
  deps: [Bus.node, Config.node, Catalog.node, Plugin.Activation.node],
})

/** @deprecated Compose the canonical `node`; retained while callers migrate. */
export const workspaceNodes = <E>(input: {
  readonly bus: WorkspaceNode<Bus.Service, E>
  readonly config: WorkspaceNode<Config.Service, E>
  readonly integration: WorkspaceNode<Integration.Service, E>
  readonly activation: Effect.Effect<void, import("./plugin/registry-service.js").ActivationError>
}) =>
  makeWorkspaceNode({
    service: Service,
    layer: layer(input.activation),
    deps: [input.bus, input.config, input.integration, Catalog.node],
  })
