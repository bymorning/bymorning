import { createData } from "@bymorning/client/solid"
import type { SessionInfo, WorkspaceEventItem } from "@bymorning/client"
import { Brand } from "effect"
import { describe, expect, test } from "vitest"

import { TestEvents, TestTransport, ids, json, message, owner } from "./fixture.js"

const eventID = Brand.nominal<WorkspaceEventItem["id"]>()

const assistant = (text: string) => ({
  id: ids.message,
  sessionID: ids.session,
  sequence: 2,
  createdAt: "2025-01-01T00:00:00.000Z",
  type: "assistant" as const,
  agent: Brand.nominal<SessionInfo["agent"]>()("agent"),
  model: { id: "model", provider: Brand.nominal<SessionInfo["model"]["provider"]>()("provider") },
  content: [{ type: "text" as const, id: "part", text }],
  usage: { cost: 0, costComplete: true, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
  time: { created: "2025-01-01T00:00:00.000Z" },
})

describe("canonical Message identity", () => {
  test("keeps Message proxies across tokens, terminal observation, and explicit recovery", async () => {
    const events = new TestEvents()
    const transport = new TestTransport()
    transport.when(
      (request) => request.url.pathname.endsWith("/message"),
      json({ data: [assistant("first")], cursor: {} }),
    )
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: events }))
    try {
      await scoped.value.session.message.sync(ids.session)
      const row = scoped.value.session.message.get(ids.session, ids.message)
      if (row?.type !== "assistant") throw new Error("Expected assistant")
      const part = row.content[0]
      events.emit({
        id: eventID("00000000-0000-4000-8000-000000000071"),
        type: "session.text.delta",
        created: 1,
        data: { sessionID: ids.session, messageID: ids.message, partID: "part", text: " token" },
      })
      expect(scoped.value.session.message.get(ids.session, ids.message)).toBe(row)
      expect(row.content[0]).toBe(part)
      expect(part).toMatchObject({ text: "first token" })
      events.emit({
        id: eventID("00000000-0000-4000-8000-000000000072"),
        type: "session.execution.succeeded",
        created: 2,
        data: {
          sessionID: ids.session,
          finish: "stop",
          message: {
            ...assistant("complete"),
            finish: "stop",
            time: { created: "2025-01-01T00:00:00.000Z", completed: "2025-01-01T00:00:01.000Z" },
          },
        },
      })
      expect(scoped.value.session.message.get(ids.session, ids.message)).toBe(row)
      expect(row.content[0]).toMatchObject({ text: "complete" })
      transport.when(
        (request) => request.url.pathname.endsWith("/message"),
        json({ data: [assistant("recovered")], cursor: {} }),
      )
      scoped.value.session.message.invalidate(ids.session)
      await scoped.value.session.message.sync(ids.session)
      expect(scoped.value.session.message.get(ids.session, ids.message)).toBe(row)
      expect(row.content[0]).toMatchObject({ text: "recovered" })
      expect(row.finish).toBeUndefined()
      expect(row.time.completed).toBeUndefined()
    } finally {
      scoped.dispose()
    }
  })

  test("preserves row identity and targets the right Message after older pagination shifts its index", async () => {
    const events = new TestEvents()
    const transport = new TestTransport()
    transport.when(
      (request) => request.url.pathname.endsWith("/message"),
      json({ data: [assistant("first")], cursor: { next: "older" } }),
    )
    transport.when(
      (request) => request.url.searchParams.get("cursor") === "older",
      json({ data: [{ ...message(), id: "00000000-0000-4000-8000-000000000005" }], cursor: {} }),
    )
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: events }))
    try {
      await scoped.value.session.message.sync(ids.session)
      const row = scoped.value.session.message.get(ids.session, ids.message)
      events.emit({
        id: eventID("00000000-0000-4000-8000-000000000073"),
        type: "session.text.delta",
        created: 1,
        data: { sessionID: ids.session, messageID: ids.message, partID: "part", text: " before" },
      })
      await scoped.value.session.message.load(ids.session)
      events.emit({
        id: eventID("00000000-0000-4000-8000-000000000074"),
        type: "session.text.delta",
        created: 2,
        data: { sessionID: ids.session, messageID: ids.message, partID: "part", text: " after" },
      })
      expect(scoped.value.session.message.get(ids.session, ids.message)).toBe(row)
      expect(row).toMatchObject({ content: [{ text: "first before after" }] })
      expect(scoped.value.session.message.list(ids.session).map((entry) => entry.sequence)).toEqual([1, 2])
      expect(scoped.value.session.message.list(ids.session)[0]).toMatchObject({ type: "user", text: "hello" })
    } finally {
      scoped.dispose()
    }
  })
})
