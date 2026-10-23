import { createData } from "@bymorning/client/solid"
import type * as SDK from "@bymorning/client"
import { describe, expect, test } from "vitest"

import { Gate, TestEvents, TestTransport, ids, json, owner } from "./fixture.js"

const eventID = "00000000-0000-4000-8000-000000000096" as SDK.WorkspaceEventItem["id"]
const created = "2025-02-03T04:05:06.000Z"
const assistant = {
  id: ids.message, sessionID: ids.session, sequence: 2, createdAt: created, type: "assistant" as const,
  agent: "agent" as SDK.SessionInfo["agent"], model: { id: "model", provider: "provider" as SDK.SessionInfo["model"]["provider"] }, content: [],
  usage: { cost: 0, costComplete: true, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }, time: { created },
}

describe("generated Session event lifecycle", () => {
  test("projects reasoning, tool, and compaction deltas through terminal dated records", () => {
    const events = new TestEvents(); const scoped = owner(() => createData({ api: () => new TestTransport().api, workspace: ids.workspace, event: events }))
    const emit = (event: SDK.WorkspaceEventItem) => events.emit({ ...event, id: crypto.randomUUID() as SDK.WorkspaceEventItem["id"] })
    emit({ id: eventID, type: "session.execution.started", created: 1, data: { sessionID: ids.session, message: assistant } })
    emit({ id: eventID, type: "session.reasoning.started", created: 2, data: { sessionID: ids.session, messageID: ids.message, partID: "reason", ordinal: 0 } })
    emit({ id: eventID, type: "session.reasoning.delta", created: 3, data: { sessionID: ids.session, messageID: ids.message, partID: "reason", text: "think" } })
    emit({ id: eventID, type: "session.reasoning.ended", created: 4, data: { sessionID: ids.session, messageID: ids.message, partID: "reason", text: "thought" } })
    emit({ id: eventID, type: "session.tool.input.started", created: 5, data: { sessionID: ids.session, messageID: ids.message, callID: "tool", ordinal: 1, name: "read" } })
    emit({ id: eventID, type: "session.tool.input.delta", created: 6, data: { sessionID: ids.session, messageID: ids.message, callID: "tool", text: "{\"x\"" } })
    emit({ id: eventID, type: "session.tool.input.ended", created: 7, data: { sessionID: ids.session, messageID: ids.message, callID: "tool", name: "read", input: "{\"x\":1}" } })
    emit({ id: eventID, type: "session.tool.called", created: 8, data: { sessionID: ids.session, messageID: ids.message, callID: "tool", name: "read", input: { x: 1 } } })
    emit({ id: eventID, type: "session.tool.progress", created: 9, data: { sessionID: ids.session, messageID: ids.message, callID: "tool", metadata: { progress: 1 } } })
    emit({ id: eventID, type: "session.tool.success", created: 10, data: { sessionID: ids.session, messageID: ids.message, callID: "tool", name: "read", input: { x: 1 }, content: [{ type: "text", text: "done" }] } })
    emit({ id: eventID, type: "session.tool.input.started", created: 11, data: { sessionID: ids.session, messageID: ids.message, callID: "failed", ordinal: 2, name: "write" } })
    emit({ id: eventID, type: "session.tool.failed", created: 12, data: { sessionID: ids.session, messageID: ids.message, callID: "failed", name: "write", input: {}, error: { _tag: "SessionError.InternalError", message: "failed" } } })
    const compactionID = "00000000-0000-4000-8000-000000000095" as SDK.MessageListOutput["data"][number]["id"]
    emit({ id: eventID, type: "session.compaction.started", created: 13, data: { sessionID: ids.session, message: { id: compactionID, sessionID: ids.session, sequence: 3, createdAt: created, type: "compaction", reason: "manual", status: "running", summary: "", recent: "" } } })
    emit({ id: eventID, type: "session.compaction.delta", created: 14, data: { sessionID: ids.session, messageID: compactionID, text: "checkpoint" } })
    emit({ id: eventID, type: "session.compaction.ended", created: 15, data: { sessionID: ids.session, message: { id: compactionID, sessionID: ids.session, sequence: 3, createdAt: created, type: "compaction", reason: "manual", status: "completed", summary: "checkpoint", recent: "recent" }, usage: assistant.usage } })
    expect(scoped.value.session.message.get(ids.session, ids.message)).toMatchObject({ content: [{ id: "reason", text: "thought" }, { id: "tool", state: { status: "completed" } }, { id: "failed", state: { status: "error" } }] })
    expect(scoped.value.session.message.list(ids.session)).toContainEqual(expect.objectContaining({ id: compactionID, summary: "checkpoint", createdAt: new Date(created) }))
    scoped.dispose()
  })

  test("does not let an ordinary read erase a live part or a terminal record", async () => {
    const events = new TestEvents(); const transport = new TestTransport(); const held = new Gate<Response>()
    transport.when((request) => request.url.pathname.endsWith("/message"), held.promise)
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: events }))
    const read = scoped.value.session.message.sync(ids.session)
    await transport.receipt(`/api/session/${ids.session}/message`)
    events.emit({ id: eventID, type: "session.execution.started", created: 1, data: { sessionID: ids.session, message: assistant } })
    events.emit({ id: eventID, type: "session.reasoning.started", created: 2, data: { sessionID: ids.session, messageID: ids.message, partID: "reason", ordinal: 0 } })
    held.resolve(json({ data: [], cursor: {} }))
    await read
    expect(scoped.value.session.message.get(ids.session, ids.message)).toMatchObject({ content: [{ id: "reason", type: "reasoning" }] })
    scoped.dispose()
  })

  test("uses run events for active state and does not finish a Run at execution terminal", () => {
    const events = new TestEvents(); const scoped = owner(() => createData({ api: () => new TestTransport().api, workspace: ids.workspace, event: events }))
    events.emit({ id: eventID, type: "session.run.started", created: 1, data: { sessionID: ids.session } })
    expect(scoped.value.session.active.get(ids.session)).toBe("running")
    events.emit({ id: eventID, type: "session.execution.succeeded", created: 2, data: { sessionID: ids.session, message: { ...assistant, content: [], createdAt: created }, finish: "stop" } })
    expect(scoped.value.session.active.get(ids.session)).toBe("running")
    events.emit({ id: eventID, type: "session.run.succeeded", created: 3, data: { sessionID: ids.session } })
    expect(scoped.value.session.active.get(ids.session)).toBe("idle")
    scoped.dispose()
  })
})
