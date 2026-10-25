import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import * as WorkspaceEvent from "../src/workspace-event.js"

const eventID = "00000000-0000-4000-8000-000000000907"
const sessionID = "00000000-0000-4000-8000-000000000902"
const messageID = "00000000-0000-4000-8000-000000000906"

describe("WorkspaceEvent schemas", () => {
  it("decodes the connection marker and direct Session Event payloads", () => {
    const connected = { id: eventID, type: "server.connected", data: {} }
    const session = {
      id: eventID,
      type: "session.text.delta",
      created: 1,
      data: { sessionID, messageID, partID: "part", text: "delta" },
    }
    expect(Schema.decodeUnknownSync(WorkspaceEvent.Item)(connected)).toEqual(connected)
    expect(Schema.decodeUnknownSync(WorkspaceEvent.Item)(session)).toEqual(session)
  })

  it("carries Project File change notices for every Workspace member", () => {
    const changed = {
      id: eventID,
      type: "project.file.changed",
      created: 1,
      data: { projectID: "prj_00000000000000000000000000", path: "reports/summary.md" },
    }
    expect(Schema.decodeUnknownSync(WorkspaceEvent.Item)(changed)).toEqual(changed)
  })
})
