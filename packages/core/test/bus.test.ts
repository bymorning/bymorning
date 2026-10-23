import { Bus } from "@bymorning/core/bus"
import * as Event from "@bymorning/schema/event"
import { Timestamp } from "@bymorning/schema/schema"
import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Context, Effect, Fiber, Layer, Schema, Stream } from "effect"
import { describe, expect } from "vitest"

const Changed = Event.define("test.changed", { id: Schema.String, value: Schema.Finite })
const Other = Event.define("test.other", { id: Schema.String })
const Timed = Event.define("test.timed", { createdAt: Timestamp })
const layer = Bus.layer.pipe(Layer.provide(NodeCrypto.layer))

describe("Bus", () => {
  it.effect("eagerly acquires typed filtered live subscriptions", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      yield* bus.publish(Changed, { id: "past", value: 0 })
      const all = yield* bus.subscribe()
      const changed = yield* bus.subscribe(Changed)
      const selected = yield* bus.subscribe([Changed, Other] as const)
      const allItems = yield* all.pipe(Stream.take(2), Stream.runCollect, Effect.forkChild)
      const changedItems = yield* changed.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild)
      const selectedItems = yield* selected.pipe(Stream.take(2), Stream.runCollect, Effect.forkChild)

      const first = yield* bus.publish(Changed, { id: "one", value: 1 })
      const second = yield* bus.publish(Other, { id: "two" })

      expect(first).toMatchObject({ type: Changed.type, data: { id: "one", value: 1 } })
      expect(first).toMatchObject({ id: expect.any(String), created: expect.any(Number) })
      expect(yield* Fiber.join(allItems)).toEqual([first, second])
      expect(yield* Fiber.join(changedItems)).toEqual([first])
      expect(yield* Fiber.join(selectedItems)).toEqual([first, second])
    }).pipe(Effect.provide(layer)),
  )

  it.effect("is live-only, releases scoped subscriptions, and accepts publication without subscribers", () =>
    Effect.gen(function* () {
      const contextA = yield* Layer.build(layer)
      const contextB = yield* Layer.build(layer)
      const busA = Context.get(contextA, Bus.Service)
      const busB = Context.get(contextB, Bus.Service)

      const noSubscriber = yield* busA.publish(Changed, { id: "none", value: 0 })
      expect(noSubscriber.type).toBe(Changed.type)

      const released = yield* Effect.scoped(busA.subscribe(Changed))
      const afterRelease = yield* busA.publish(Changed, { id: "after-release", value: 1 })
      const releasedResult = yield* released.pipe(Stream.runHead)
      expect(releasedResult._tag).toBe("None")

      const fromA = yield* busA.subscribe(Changed)
      const receivedA = yield* fromA.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild)
      const foreign = yield* busB.publish(Changed, { id: "foreign", value: 2 })
      yield* Effect.yieldNow
      expect(receivedA.pollUnsafe()).toBeUndefined()
      const local = yield* busA.publish(Changed, { id: "local", value: 3 })
      expect(yield* Fiber.join(receivedA)).toEqual([local])
      expect(foreign.data.id).toBe("foreign")
      expect(afterRelease.data.id).toBe("after-release")
    }).pipe(Effect.scoped),
  )

  it.effect("publishes domain timestamps while preserving their Date representation", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const createdAt = new Date(0)
      const event = yield* bus.publish(Timed, { createdAt })

      expect(event.data.createdAt).toEqual(createdAt)
    }).pipe(Effect.provide(layer)),
  )
})
