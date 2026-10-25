import * as Event from "@bymorning/schema/event"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

const event = { id: "00000000-0000-4000-8000-000000000004", type: "test.changed", created: 1, data: { value: "ok" } }

describe("public event schemas", () => {
  it("defines a pure live event schema", () => {
    const definitions = Event.inventory()
    const definition = Event.define("test.changed", { value: Schema.String })
    expect(definitions).toEqual([])
    expect(Schema.encodeSync(definition)(Schema.decodeUnknownSync(definition)(event))).toEqual(event)
  })
})
