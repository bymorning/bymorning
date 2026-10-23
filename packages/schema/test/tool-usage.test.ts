import { Session } from "@bymorning/schema/session"
import { SessionEvent } from "@bymorning/schema/session-event"
import { ToolUsage } from "@bymorning/schema/tool-usage"
import { ToolUsageEvent } from "@bymorning/schema/tool-usage-event"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { Schema } from "effect"
import { expect, test } from "vitest"

const id = "00000000-0000-4000-8000-000000000001"
const sessionID = "00000000-0000-4000-8000-000000000002"
const userID = "usr_tool_usage"

test("defines the canonical Tool Usage record", () => {
  const record = ToolUsage.Record.make({
    id: ToolUsage.ID.make(id),
    workspaceID: Workspace.ID.make("wrk_tool_usage"),
    userID: User.ID.make(userID),
    sessionID: Session.ID.make(sessionID),
    tool: "shell",
    status: "completed",
    occurredAt: new Date("2026-09-03T12:00:00.000Z"),
  })

  expect(record).toMatchObject({ tool: "shell", status: "completed" })
  expect(ToolUsage.Record.make({ ...record, sessionID: null }).sessionID).toBeNull()
  expect(() => ToolUsage.Record.make({ ...record, tool: "" })).toThrow()
  expect(() => Schema.decodeUnknownSync(ToolUsage.Record)({ ...record, status: "started" })).toThrow()
  expect(() => Schema.decodeUnknownSync(ToolUsage.Record)({ ...record, sessionID: undefined })).toThrow()
})

test("records private Tool Usage as a live event", () => {
  expect(ToolUsageEvent.Recorded.type).toBe("tool.usage.recorded")
  expect(SessionEvent.Definitions.map((definition) => definition.type)).not.toContain(ToolUsageEvent.Recorded.type)

  const event = Schema.decodeUnknownSync(ToolUsageEvent.Recorded)({
    id,
    type: "tool.usage.recorded",
    created: 1,
    data: { userID, sessionID: null, tool: "read", status: "error" },
  })

  expect(event.data).toEqual({ userID, sessionID: null, tool: "read", status: "error" })
  expect(event.data).not.toHaveProperty("id")
  expect(event.data).not.toHaveProperty("occurredAt")
  expect(event.data).not.toHaveProperty("workspaceID")
  expect(Schema.decodeUnknownSync(ToolUsageEvent.Recorded)({ ...event, durable: { aggregateID: userID } })).toEqual(
    event,
  )
})
