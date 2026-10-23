import { Bus } from "@bymorning/core/bus"
import * as Event from "@bymorning/schema/event"
import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Fiber, Layer, Schema, Stream } from "effect"
import { expect } from "vitest"

const Ordered = Event.define("bus.ordered", { value: Schema.Int })
const layer = Bus.layer.pipe(Layer.provide(NodeCrypto.layer))

it.effect("delivers locally accepted publications in FIFO order to one subscriber", () =>
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const stream = yield* bus.subscribe(Ordered)
    const received = yield* stream.pipe(Stream.take(3), Stream.runCollect, Effect.forkChild)

    const first = yield* bus.publish(Ordered, { value: 1 })
    const second = yield* bus.publish(Ordered, { value: 2 })
    const third = yield* bus.publish(Ordered, { value: 3 })

    expect(yield* Fiber.join(received)).toEqual([first, second, third])
  }).pipe(Effect.provide(layer)),
)
