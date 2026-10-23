import { createData } from "@bymorning/client/solid"
import { describe, expect, test } from "vitest"

import { Gate, TestEvents, TestTransport, ids, json, owner } from "./fixture.js"

const assistant = (text: string) => ({
  id: ids.message, sessionID: ids.session, sequence: 2, createdAt: "2025-01-01T00:00:00.000Z", type: "assistant" as const,
  agent: "agent", model: { id: "model", provider: "provider" }, content: [{ type: "text" as const, id: "part", text }],
  usage: { cost: 0, costComplete: true, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }, time: { created: "2025-01-01T00:00:00.000Z" },
})

describe("live Message projection", () => {
  test("projects an assistant start and text delta before the application listener observes the delta", () => {
    const events = new TestEvents()
    const transport = new TestTransport()
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: events }))
    let observed: unknown
    events.listen((event) => { if (event.type === "session.text.delta") observed = scoped.value.session.message.get(ids.session, ids.message) })
    events.emit({ id: "00000000-0000-4000-8000-000000000035" as never, type: "session.execution.started", created: 1, data: { sessionID: ids.session, message: assistant("") } } as never)
    events.emit({ id: "00000000-0000-4000-8000-000000000036" as never, type: "session.text.started", created: 2, data: { sessionID: ids.session, messageID: ids.message, partID: "part", ordinal: 0 } } as never)
    events.emit({ id: "00000000-0000-4000-8000-000000000037" as never, type: "session.text.delta", created: 3, data: { sessionID: ids.session, messageID: ids.message, partID: "part", text: "live" } } as never)
    expect(observed).toMatchObject({ content: [{ id: "part", text: "live" }] })
    scoped.dispose()
  })

  test("does not let an overtaken ordinary read erase a terminal authoritative Message", async () => {
    const events = new TestEvents()
    const transport = new TestTransport()
    const held = new Gate<Response>()
    transport.when((request) => request.url.pathname.endsWith("/message"), held.promise)
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: events }))
    const read = scoped.value.session.message.sync(ids.session)
    await transport.receipt(`/api/session/${ids.session}/message`)
    events.emit({ id: "00000000-0000-4000-8000-000000000038" as never, type: "session.execution.succeeded", created: 4, data: { sessionID: ids.session, finish: "stop", message: assistant("authoritative") } } as never)
    held.resolve(json({ data: [assistant("stale")], cursor: {} }))
    await read
    expect(scoped.value.session.message.get(ids.session, ids.message)).toMatchObject({ content: [{ text: "authoritative" }] })
    scoped.dispose()
  })
})
