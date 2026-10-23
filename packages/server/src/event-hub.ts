export * as EventHub from "./event-hub.js"

import { Account } from "@bymorning/schema/account"
import { Event } from "@bymorning/schema/event"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { WorkspaceEvent } from "@bymorning/schema/workspace-event"
import { Cause, Context, Effect, Layer, Queue, Schema, Scope, Stream } from "effect"
import { Sse } from "effect/unstable/encoding"
import { makeGlobalNode, type GlobalNode, makeWorkspaceNode } from "@bymorning/util/effect/app-node"

/** Maximum live Events retained for an individual response. */
export const SubscriberCapacity = 4096

export interface SubscriberIdentity {
  readonly workspaceID: Workspace.ID
  readonly accountID: Account.ID
  readonly userID: User.ID
}

export class OverflowError extends Schema.TaggedError<OverflowError>()("EventHub.OverflowError", {}) {}
export class SourceError extends Schema.TaggedError<SourceError>()("EventHub.SourceError", {}) {}
export class EncodingError extends Schema.TaggedError<EncodingError>()("EventHub.EncodingError", {}) {}
export type Error = OverflowError | SourceError | EncodingError

export interface Delivery {
  readonly item: WorkspaceEvent.Item
  readonly frame: string
}
export type Source = "shared" | "user"

export interface Interface {
  readonly subscribe: (identity: SubscriberIdentity) => Effect.Effect<Stream.Stream<Delivery, Error>, never, Scope.Scope>
  readonly publishWorkspace: (workspaceID: Workspace.ID, item: WorkspaceEvent.Item) => Effect.Effect<void, EncodingError>
  readonly publishAccount: (workspaceID: Workspace.ID, accountID: Account.ID, item: WorkspaceEvent.Item) => Effect.Effect<void, EncodingError>
  readonly publishUser: (workspaceID: Workspace.ID, userID: User.ID, item: WorkspaceEvent.Item) => Effect.Effect<void, EncodingError>
  readonly sourceStarted: (identity: SubscriberIdentity, source: Source) => Effect.Effect<void>
  readonly sourceEnded: (identity: SubscriberIdentity, source: Source) => Effect.Effect<void>
}

/** Process-local, audience-partitioned live Event fan-out. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/server/EventHub") {}

const encode = Schema.encodeUnknownEffect(Schema.fromJsonString(WorkspaceEvent.Item))
export const delivery = Effect.fn("EventHub.delivery")(function* (item: WorkspaceEvent.Item) {
  const data = yield* encode(item).pipe(Effect.mapError(() => new EncodingError()))
  return { item, frame: Sse.encoder.write({ _tag: "Event", event: "message", id: undefined, data }) }
})

interface Subscriber { readonly identity: SubscriberIdentity; readonly queue: Queue.Queue<Delivery, Error> }
const sourceKey = (identity: SubscriberIdentity, source: Source) =>
  source === "shared" ? `${identity.workspaceID}\0` : `${identity.workspaceID}\0${identity.accountID}\0${identity.userID}`

export const layer = (capacity = SubscriberCapacity): Layer.Layer<Service> => Layer.effect(Service, Effect.gen(function* () {
  const subscribers = new Set<Subscriber>()
  const failed = { shared: new Set<string>(), user: new Set<string>() }
  const publish = Effect.fn("EventHub.publish")(function* (matches: (identity: SubscriberIdentity) => boolean, item: WorkspaceEvent.Item) {
    const targets = [...subscribers].filter(({ identity }) => matches(identity))
    if (targets.length === 0) return
    const encoded = yield* delivery(item)
    for (const subscriber of targets) {
      if (Queue.offerUnsafe(subscriber.queue, encoded)) continue
      subscribers.delete(subscriber)
      Queue.failCauseUnsafe(subscriber.queue, Cause.fail(new OverflowError()))
    }
  })
  return Service.of({
    subscribe: (identity) => Effect.acquireRelease(
      Effect.gen(function* () {
        const subscriber = { identity, queue: yield* Queue.bounded<Delivery, Error>(capacity) }
        if (failed.shared.has(sourceKey(identity, "shared")) || failed.user.has(sourceKey(identity, "user")))
          Queue.failCauseUnsafe(subscriber.queue, Cause.fail(new SourceError()))
        else subscribers.add(subscriber)
        return subscriber
      }),
      (subscriber) => Effect.sync(() => subscribers.delete(subscriber)).pipe(Effect.andThen(Queue.shutdown(subscriber.queue)), Effect.asVoid),
    ).pipe(Effect.map(({ queue }) => Stream.fromQueue(queue))),
    publishWorkspace: (workspaceID, item) => publish((identity) => identity.workspaceID === workspaceID, item),
    publishAccount: (workspaceID, accountID, item) => publish((identity) => identity.workspaceID === workspaceID && identity.accountID === accountID, item),
    publishUser: (workspaceID, userID, item) => publish((identity) => identity.workspaceID === workspaceID && identity.userID === userID, item),
    sourceStarted: (identity, source) => Effect.sync(() => { failed[source].delete(sourceKey(identity, source)) }),
    sourceEnded: (identity, source) => Effect.sync(() => {
      failed[source].add(sourceKey(identity, source))
      for (const subscriber of subscribers) {
        if (source === "shared" ? subscriber.identity.workspaceID !== identity.workspaceID : sourceKey(subscriber.identity, source) !== sourceKey(identity, source)) continue
        subscribers.delete(subscriber)
        Queue.failCauseUnsafe(subscriber.queue, Cause.fail(new SourceError()))
      }
    }),
  })
}))

export const connected = () => WorkspaceEvent.Connected.make({ id: Event.ID.make(crypto.randomUUID()), type: "server.connected", data: {} })
export const node = makeGlobalNode({ service: Service, layer: layer(), deps: [] })
export const workspaceBridgeNode = <E>(eventHub: GlobalNode<Service, E>) => makeWorkspaceNode({ service: Service, layer: Layer.effect(Service, Service), deps: [eventHub] })
