import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { EventHub } from "./event-hub.js"

it.effect("frames a direct server-connected Event", () =>
  Effect.gen(function* () {
    const delivery = yield* EventHub.delivery(EventHub.connected())
    expect(delivery.item.type).toBe("server.connected")
    expect(delivery.frame).toContain('"type":"server.connected"')
  }),
)
