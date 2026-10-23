export * as WorkspaceEventBroadcaster from "./workspace-event-broadcaster.js"

import { Bus } from "@bymorning/core/bus"
import { Integration } from "@bymorning/core/integration"
import { Event } from "@bymorning/schema/event"
import { Workspace } from "@bymorning/schema/workspace"
import { Context, Effect, Layer, Scope, SynchronizedRef } from "effect"
import { WorkspaceMap } from "./workspace-map.js"
import { Credential } from "@bymorning/core/credential"
import { Actor } from "@bymorning/core/actor"
import { AppProcess } from "@bymorning/core/util/process"
import { makeGlobalNode, makeWorkspaceNode, type GlobalNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"

export interface Interface {
  readonly register: (
    workspaceID: Workspace.ID,
    key: WorkspaceMap.RuntimeKey,
    bus: Bus.Interface,
  ) => Effect.Effect<void, never, Scope.Scope>
  readonly publish: <D extends Integration.MutationDefinition>(
    workspaceID: Workspace.ID,
    definition: D,
    data: Event.Data<D>,
  ) => Effect.Effect<void>
}

/** Fanout to loaded runtime graphs only; registration follows each graph's scope. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/server/WorkspaceEventBroadcaster") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const registrations = yield* SynchronizedRef.make(new Map<Workspace.ID, Map<string, Bus.Interface>>())
    return Service.of({
      register: (workspaceID, key, bus) =>
        Effect.acquireRelease(
          SynchronizedRef.update(registrations, (current) => {
            const next = new Map(current)
            const workspace = new Map(next.get(workspaceID) ?? [])
            workspace.set(key.accountID, bus)
            next.set(workspaceID, workspace)
            return next
          }),
          () =>
            SynchronizedRef.update(registrations, (current) => {
              const next = new Map(current)
              const workspace = new Map(next.get(workspaceID) ?? [])
              workspace.delete(key.accountID)
              if (workspace.size === 0) next.delete(workspaceID)
              else next.set(workspaceID, workspace)
              return next
            }),
        ),
      publish: (workspaceID, definition, data) =>
        SynchronizedRef.get(registrations).pipe(
          Effect.flatMap((current) =>
            Effect.forEach(
              Array.from(current.get(workspaceID)?.values() ?? []),
              (bus) =>
                bus
                  .publish(definition, data)
                  .pipe(
                    Effect.catchCause((cause) =>
                      Effect.logError("Workspace event fanout failed", { workspaceID, cause }),
                    ),
                  ),
              { discard: true, concurrency: "unbounded" },
            ),
          ),
        ),
    })
  }),
)

/** Canonical process-global loaded-workspace event broadcaster. */
export const node = makeGlobalNode({ service: Service, layer, deps: [] })

/** Register one workspace Bus for the lifetime of its retained graph. */
export const registrationNode = <E>(input: {
  readonly bus: WorkspaceNode<Bus.Service, E>
  readonly broadcaster: GlobalNode<Service, E>
}) =>
  makeWorkspaceNode({
    name: "@bymorning/server/WorkspaceEventBroadcaster.register",
    layer: Layer.effectDiscard(
      Effect.gen(function* () {
        const broadcaster = yield* Service
        const bus = yield* Bus.Service
        const owner = yield* Actor.Binding.Service
        const key = yield* WorkspaceMap.Runtime
        yield* broadcaster.register(owner.workspaceID, key, bus)
      }),
    ),
    deps: [Actor.binding, WorkspaceMap.runtime, input.broadcaster, input.bus],
  })

/** Canonical Integration adapter publishing mutations into loaded workspace graphs. */
export const integrationPublisherNode = <E>(input: {
  readonly bus: WorkspaceNode<Bus.Service, E>
  readonly broadcaster: GlobalNode<Service, E>
  readonly credential?: WorkspaceNode<Credential.Service, E>
}) =>
  makeWorkspaceNode({
    service: Integration.Service,
    layer: Layer.unwrap(
      Effect.gen(function* () {
        const owner = yield* Actor.Binding.Service
        const broadcaster = yield* Service
        const bus = yield* Bus.Service
        return Integration.layerWith({
          publish: (definition, data, scope) =>
            scope === "member"
              ? bus.publish(definition, data).pipe(Effect.asVoid, Effect.orDie)
              : broadcaster.publish(owner.workspaceID, definition, data),
        })
      }),
    ),
    deps: [input.credential ?? Credential.node, Actor.binding, input.bus, AppProcess.node, input.broadcaster],
  })
