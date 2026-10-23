import * as Permission from "@bymorning/schema/permission"
import * as Agent from "@bymorning/schema/agent"
import * as Message from "@bymorning/schema/message"
import * as Session from "@bymorning/schema/session"
import { Schema } from "effect"
import { expect, test } from "vitest"

test("retains OpenCode-compatible empty Permission strings and arrays", () => {
  expect(Schema.decodeUnknownSync(Permission.Ruleset)([{ action: "", resource: "", effect: "ask" }])).toEqual([
    { action: "", resource: "", effect: "ask" },
  ])
  expect(Permission.ID.create()).toMatch(/^per_/)
  expect(Permission.SavedID.create()).toMatch(/^psv_/)
})

test("reuses canonical related identity schemas", () => {
  expect(Permission.Source.fields.messageID).toBe(Message.ID)
  expect(Permission.Request.fields.sessionID).toBe(Session.ID)
  expect(
    Schema.decodeUnknownSync(Permission.AssertInput)({
      sessionID: "00000000-0000-4000-8000-000000000001",
      action: "read",
      resources: [],
      agent: Agent.DefaultID,
    }).agent,
  ).toBe(Agent.DefaultID)
})
