import * as SessionEvent from "@bymorning/schema/session-event"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"

const sessionID = "00000000-0000-4000-8000-000000000001"
const messageID = "00000000-0000-4000-8000-000000000002"
const eventID = "00000000-0000-4000-8000-000000000004"

describe("SessionEvent schemas", () => {
  test("publishes the approved live inventory", () => {
    expect(SessionEvent.Definitions).toContain(SessionEvent.TextDelta)
    expect(SessionEvent.Definitions).toContain(SessionEvent.PermissionAsked)
    expect(SessionEvent.Definitions).not.toContain(SessionEvent.PolicyToolAdmitted)
    expect(new Set(SessionEvent.Definitions.map((event) => event.type)).size).toBe(SessionEvent.Definitions.length)
  })

  test("round-trips a direct live payload", () => {
    const payload = {
      id: eventID,
      type: "session.text.delta",
      created: 1,
      data: { sessionID, messageID, partID: "part", text: "delta" },
    }
    expect(Schema.encodeSync(SessionEvent.Payload)(Schema.decodeUnknownSync(SessionEvent.Payload)(payload))).toEqual(payload)
  })

  test("requires an ordinal for started parts", () => {
    expect(() =>
      Schema.decodeUnknownSync(SessionEvent.TextStarted)({
        id: eventID,
        type: "session.text.started",
        created: 1,
        data: { sessionID, messageID, partID: "part" },
      }),
    ).toThrow()
  })
})
