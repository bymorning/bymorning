export * as EventFeed from "./event-feed.js"

import { Actor } from "@bymorning/core/actor"
import { Bus } from "@bymorning/core/bus"
import { Form } from "@bymorning/core/form"
import { Permission } from "@bymorning/core/permission"
import { Session } from "@bymorning/core/session"
import { AgentEvent } from "@bymorning/schema/agent-event"
import { Config } from "@bymorning/schema/config"
import { Integration } from "@bymorning/schema/integration"
import { OutboundMCP } from "@bymorning/schema/outbound-mcp"
import { Plugin } from "@bymorning/schema/plugin"
import { Project } from "@bymorning/schema/project"
import { ScheduledTask } from "@bymorning/schema/scheduled-task"
import { SessionEvent } from "@bymorning/schema/session-event"
import { WorkspaceEvent } from "@bymorning/schema/workspace-event"
import { Cause, Effect, Layer, Scope, Stream } from "effect"
import { EventHub } from "./event-hub.js"
import { makeWorkspaceNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"

// Project Files are Workspace resources, so their change notices reach every Workspace member.
const SharedDefinitions = [...AgentEvent.Definitions, Config.Event.Updated, Plugin.Event.Added, Plugin.Event.Updated, Integration.Event.Updated, Integration.Event.ConnectionUpdated, OutboundMCP.Event.StatusChanged, Project.FileChanged] as const

/** Bridge one member-bound Bus into the process-wide authorized Event hub. */
export const sourceLayer = (identity: EventHub.SubscriberIdentity) => Layer.effectDiscard(Effect.gen(function* () {
  const bus = yield* Bus.Service
  const hub = yield* EventHub.Service
  const shared = yield* bus.subscribe(SharedDefinitions)
  // Scheduled Task records belong to one member, so their Events ride the user-scoped source with Session Events.
  const session = yield* bus.subscribe([...SessionEvent.Definitions, ...ScheduledTask.Definitions])
  const supervise = (source: EventHub.Source, stream: Stream.Stream<WorkspaceEvent.Item>) =>
    Stream.runForEach(stream, (item) => {
      if (source === "user") return hub.publishUser(identity.workspaceID, identity.userID, item)
      if (
        item.type === Plugin.Event.Added.type ||
        item.type === Plugin.Event.Updated.type ||
        item.type === Integration.Event.Updated.type ||
        item.type === Integration.Event.ConnectionUpdated.type ||
        item.type === OutboundMCP.Event.StatusChanged.type
      )
        return hub.publishAccount(identity.workspaceID, identity.accountID, item)
      return hub.publishWorkspace(identity.workspaceID, item)
    }).pipe(
      Effect.catchCause((cause) => Cause.hasInterrupts(cause) ? Effect.void : hub.sourceEnded(identity, source)),
      Effect.ensuring(hub.sourceEnded(identity, source)),
      Effect.forkScoped,
    )
  yield* hub.sourceStarted(identity, "shared")
  yield* hub.sourceStarted(identity, "user")
  yield* supervise("shared", shared)
  yield* supervise("user", session)
}))

/** Scoped source bridge for the retained member graph. */
export const sourceNode = <E>(handles: { readonly bus: WorkspaceNode<Bus.Service, E>; readonly eventHub: WorkspaceNode<EventHub.Service, E>; readonly session: WorkspaceNode<Session.Service, E>; readonly permission: WorkspaceNode<Permission.Service, E>; readonly form: WorkspaceNode<Form.Service, E> }) =>
  makeWorkspaceNode({ name: "@bymorning/server/EventFeed.source", layer: Layer.unwrap(Effect.map(Actor.Binding.Service, (identity) => sourceLayer(identity))), deps: [Actor.binding, handles.bus, handles.eventHub, handles.session, handles.permission, handles.form] })

/** Open the sole authorized live Event stream. It has no replay or resource selectors. */
export const subscribe = Effect.fn("EventFeed.subscribe")(function* () {
  const identity = yield* Actor.Binding.Service
  const hub = yield* EventHub.Service
  const stream = yield* hub.subscribe(identity)
  const first = yield* EventHub.delivery(EventHub.connected())
  return Stream.concat(Stream.make(first), stream) as Stream.Stream<EventHub.Delivery, EventHub.Error>
})
