export * as Bus from "./bus.js"

import { Event } from "@bymorning/schema/event"
import { makeWorkspaceNode, type WorkspaceProvider } from "@bymorning/util/effect/app-node"
import { crypto } from "@bymorning/util/effect/app-node-platform"
import { Clock, Context, Crypto, Effect, Layer, PubSub, Schema, Scope, Stream } from "effect"

/** A live Event subscription, optionally restricted to one or more definitions. */
export interface Subscribe {
  (): Effect.Effect<Stream.Stream<Event.Payload>, never, Scope.Scope>
  <D extends Event.Definition>(definition: D): Effect.Effect<Stream.Stream<Event.Payload<D>>, never, Scope.Scope>
  <const D extends readonly [Event.Definition, ...Event.Definition[]]>(
    definitions: D,
  ): Effect.Effect<Stream.Stream<Event.Payload<D[number]>>, never, Scope.Scope>
}

/** Process-local typed Event publication and live subscription. */
export interface Interface {
  readonly publish: <D extends Event.Definition>(
    definition: D,
    data: Event.Data<D>,
    options?: { readonly created?: Date | number },
  ) => Effect.Effect<Event.Payload<D>>
  readonly subscribe: Subscribe
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Bus") {}

const isDefinition = (value: Event.Definition | readonly Event.Definition[]): value is Event.Definition =>
  !Array.isArray(value)

/** A volatile Bus. Publication succeeds even when it has no subscribers. */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const events = yield* PubSub.unbounded<Event.Payload>()
    yield* Effect.addFinalizer(() => PubSub.shutdown(events))

    const publish = ((definition, data, options) =>
      Effect.gen(function* () {
        // Data arrives through the typed public boundary in its decoded domain
        // form. Encoding validates that form without changing the live payload.
        yield* Schema.encodeUnknownEffect(definition.data)(data).pipe(Effect.orDie)
        const created = options?.created instanceof Date ? options.created.getTime() : options?.created
        const event = {
          id: yield* crypto.randomUUIDv4.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Event.ID)),
            Effect.orDie,
          ),
          type: definition.type,
          created: yield* Schema.decodeUnknownEffect(Event.Created)(created ?? (yield* Clock.currentTimeMillis)).pipe(
            Effect.orDie,
          ),
          data,
        } as Event.Payload<typeof definition>
        yield* PubSub.publish(events, event)
        return event
      })) as Interface["publish"]

    const subscribe = ((input?: Event.Definition | readonly Event.Definition[]) => {
      const types = input === undefined ? undefined : new Set((isDefinition(input) ? [input] : input).map(({ type }) => type))
      // Acquiring the PubSub subscription here, rather than while the Stream is
      // run, makes the returned stream a reliable live boundary.
      return PubSub.subscribe(events).pipe(
        Effect.map((subscription) =>
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((event) => types === undefined || types.has(event.type)),
            Stream.map((event) => event as never),
          ),
        ),
      )
    }) as Subscribe

    return Service.of({ publish, subscribe })
  }),
) as Layer.Layer<Service, never, Crypto.Crypto>

/** Canonical member Bus; audience routing is performed by its consumers. */
export const node = makeWorkspaceNode({ service: Service, layer, deps: [crypto] }) as WorkspaceProvider<Service>
