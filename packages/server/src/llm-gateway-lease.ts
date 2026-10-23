import { NodeCrypto } from "@effect/platform-node"
import { NodeServices } from "./node-services.js"
import { Bus } from "@bymorning/core/bus"
import { Catalog } from "@bymorning/core/catalog"
import { Cipher } from "@bymorning/core/cipher"
import { WorkspaceConfig } from "@bymorning/core/config"
import { Credential } from "@bymorning/core/credential"
import { Database } from "@bymorning/core/database"
import { Installation } from "@bymorning/core/installation"
import { Integration } from "@bymorning/core/integration"
import { LLMGateway } from "@bymorning/gateway/llm-gateway"
import { Model } from "@bymorning/core/model"
import { Limiter } from "@bymorning/core/limiter"
import { Plugin } from "@bymorning/core/plugin"
import { Storage } from "@bymorning/core/storage"
import type { Config } from "@bymorning/schema/config"
import { ModelResolver } from "@bymorning/core/model-resolver"
import { Provider } from "@bymorning/core/provider"
import { Usage } from "@bymorning/core/usage"
import { AppProcess } from "@bymorning/core/util/process"
import { Workspace } from "@bymorning/schema/workspace"
import type { GlobalNode } from "@bymorning/util/effect/app-node"
import { makeGlobalNode } from "@bymorning/util/effect/app-node"
import { Context, Data, Duration, Effect, Layer, LayerMap } from "effect"

export * as LLMGatewayLease from "./llm-gateway-lease.js"

/** Builds the Workspace-only capability graph one lease retains. */
export type Recipe = (workspaceID: Workspace.ID) => Layer.Layer<LLMGateway.Capabilities>

class Key extends Data.Class<{ readonly workspaceID: Workspace.ID }> {}

/** Lease over any recipe; inactive Workspace graphs are retained for ten minutes by default. */
export const layerFromFactory = (input: {
  readonly acquire: Recipe
  readonly idleTimeToLive?: Duration.Duration
}): Layer.Layer<LLMGateway.Lease.Service> =>
  Layer.effect(
    LLMGateway.Lease.Service,
    Effect.gen(function* () {
      // One memo map per Workspace: shared module-level Layers must not cross Workspaces.
      const mapped = yield* LayerMap.make((key: Key) => Layer.fresh(input.acquire(key.workspaceID)), {
        idleTimeToLive: input.idleTimeToLive ?? Duration.minutes(10),
      })
      return LLMGateway.Lease.Service.of({
        acquire: (workspaceID) => mapped.contextEffect(new Key({ workspaceID })),
        invalidate: (workspaceID) => mapped.invalidate(new Key({ workspaceID })),
      })
    }),
  )

/**
 * Production lease. The canonical `.node` Workspace graph is member-bound through `Actor.binding`, so the
 * Workspace-only Gateway graph is composed here from the process-shared Database, Provider, and Model services.
 */
export const layer = Layer.effect(
  LLMGateway.Lease.Service,
  Effect.gen(function* () {
    const shared = yield* Plugin.Workspace.Service
    return LLMGateway.Lease.Service.of({
      acquire: (workspaceID) =>
        Effect.gen(function* () {
          const runtime = yield* shared.acquire(workspaceID)
          yield* Context.get(runtime, Plugin.Service).awaitActivation.pipe(
            Effect.mapError(
              () => new LLMGateway.UnavailableError({ reason: "Required inference Plugin is unavailable" }),
            ),
          )
          return runtime
        }),
      // Reload the retained owning activation; never create a second Workspace copy.
      // Fork the refresh+reload so api.config.update returns after persisting
      // while hooks.drain waits for active invocations to close. The drain
      // delays replacement until long streams end; reservations stay valid in
      // their invocation Scope and counters stay process-owned.
      invalidate: (workspaceID) =>
        Effect.gen(function* () {
          const runtime = yield* Effect.scoped(shared.acquire(workspaceID))
          yield* Effect.forkDetach(Plugin.Workspace.reload(runtime)).pipe(Effect.asVoid)
        }),
    })
  }),
)

type Shared = Database.Service | Provider.Service | Model.Service | Storage.Service | Limiter.Service | Installation.Service | Cipher.Service

const recipe = (
  workspaceID: Workspace.ID,
  shared: Context.Context<Shared>,
  startup: Parameters<typeof Plugin.configured>[0],
  defaults: readonly Config.Entry[],
): Layer.Layer<Plugin.Workspace.Capabilities> => {
  const dependencies = Layer.mergeAll(
    Layer.succeed(Database.Service, Context.get(shared, Database.Service)),
    Layer.succeed(Provider.Service, Context.get(shared, Provider.Service)),
    Layer.succeed(Model.Service, Context.get(shared, Model.Service)),
    Layer.succeed(Storage.Service, Context.get(shared, Storage.Service)),
    Layer.succeed(Limiter.Service, Context.get(shared, Limiter.Service)),
    Layer.succeed(Installation.Service, Context.get(shared, Installation.Service)),
    Layer.succeed(Cipher.Service, Context.get(shared, Cipher.Service)),
  )
  const bus = Bus.layer.pipe(Layer.provide(NodeCrypto.layer))
  const integration = Integration.layerWith().pipe(
    Layer.provide(
      Layer.mergeAll(Credential.layer(workspaceID), bus, AppProcess.layer.pipe(Layer.provide(NodeServices.layer))),
    ),
    Layer.provide(dependencies),
  )
  const registration = Provider.integrationLayer.pipe(Layer.provideMerge(integration))
  const config = WorkspaceConfig.layer(workspaceID, defaults).pipe(
    Layer.provide(bus),
    Layer.provide(dependencies),
    Layer.orDie,
  )
  const catalog = Catalog.layer.pipe(Layer.provideMerge(Layer.mergeAll(registration, config, dependencies)))
  const resolver = ModelResolver.layer.pipe(Layer.provideMerge(catalog))
  const usage = Usage.layer(workspaceID).pipe(Layer.provide(NodeCrypto.layer), Layer.provide(dependencies))
  const hooks = Plugin.Hooks.layer
  const base = Layer.mergeAll(resolver, usage, config, hooks, bus)
  const activation = Layer.unwrap(
    Effect.gen(function* () {
      return Plugin.workspace(
        {
          scope: "workspace",
          workspaceID,
          app: startup.app,
          catalog: yield* Catalog.Service,
          shellHooks: yield* Plugin.Hooks.Service,
          storage: yield* Storage.Service,
        },
        startup,
      )
    }),
  ).pipe(Layer.provideMerge(base), Layer.provide(dependencies))
  return activation
}

/** Process-owned Workspace activation map, with one shared activity-limit authority. */
export const runtimeNode = <E>(
  database: GlobalNode<Database.Service, E>,
  storage: GlobalNode<Storage.Service, E>,
  startup: Parameters<typeof Plugin.configured>[0],
  defaults: readonly Config.Entry[] = [],
) =>
  makeGlobalNode({
    service: Plugin.Workspace.Service,
    layer: Layer.unwrap(
      Effect.map(Effect.context<Shared>(), (shared) =>
        Plugin.Workspace.layer((workspaceID) => recipe(workspaceID, shared, startup, defaults)),
      ),
    ).pipe(Layer.provide(Limiter.sharedLayer)),
    deps: [database, storage, Provider.node, Model.node, Limiter.stateNode, Installation.node, Cipher.node],
  })

/** Gateway consumes the same retained activation map as member composition. */
export const node = <E>(runtime: GlobalNode<Plugin.Workspace.Service, E>) =>
  makeGlobalNode({ service: LLMGateway.Lease.Service, layer, deps: [runtime] })
