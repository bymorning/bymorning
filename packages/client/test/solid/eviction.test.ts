import { createData } from "@bymorning/client/solid"
import { describe, expect, test } from "vitest"

import { Gate, TestEvents, TestTransport, ids, json, message, owner } from "./fixture.js"

describe("selected-session eviction", () => {
  test("does not let Inbox, Permission, or Form reads recreate an evicted record", async () => {
    const transport = new TestTransport()
    const inbox = new Gate<Response>(), permission = new Gate<Response>(), form = new Gate<Response>()
    transport.when((request) => request.url.pathname.endsWith("/inbox"), inbox.promise)
    transport.when((request) => request.url.pathname.endsWith("/permission"), permission.promise)
    transport.when((request) => request.url.pathname.endsWith("/form"), form.promise)
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: new TestEvents() }))

    const reads = [scoped.value.session.inbox.sync(ids.session), scoped.value.session.permission.sync(ids.session), scoped.value.session.form.sync(ids.session)]
    await Promise.all([transport.receipt(`/api/session/${ids.session}/inbox`), transport.receipt(`/api/session/${ids.session}/permission`), transport.receipt(`/api/session/${ids.session}/form`)])
    scoped.value.session.evict(ids.session)
    inbox.resolve(json({ data: [{ id: ids.message, sessionID: ids.session, admittedSequence: 1, createdAt: "2025-01-01T00:00:00.000Z", type: "user", payload: { text: "stale" }, delivery: "queue" }] }))
    permission.resolve(json([{ id: "per_stale", sessionID: ids.session, action: "read", resources: [] }]))
    form.resolve(json([{ id: "frm_stale", sessionID: ids.session, title: "Stale", fields: [{ key: "answer", type: "string" }] }]))
    await Promise.all(reads)
    expect(scoped.value.session.inbox.list(ids.session)).toEqual([])
    expect(scoped.value.session.permission.list(ids.session)).toEqual([])
    expect(scoped.value.session.form.list(ids.session)).toEqual([])
    scoped.dispose()
  })

  test("repeated eviction of an idle evicted Session is a no-op that still permits reselection", async () => {
    const transport = new TestTransport()
    transport.when((request) => request.url.pathname.endsWith("/message"), json({ data: [message()], cursor: {} }))
    const events = new TestEvents()
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: events }))
    await scoped.value.session.message.sync(ids.session)
    expect(scoped.value.session.message.list(ids.session)).toHaveLength(1)
    scoped.value.session.evict(ids.session)
    const delta = () => events.emit({ id: crypto.randomUUID(), type: "session.text.delta", created: Date.now(), data: { sessionID: ids.session, messageID: ids.message, partID: "text", text: "x" } } as never)
    // Live events for an evicted Session leave it bare, and eviction stays cheap and stable.
    for (let index = 0; index < 50; index++) {
      delta()
      scoped.value.session.evict(ids.session)
    }
    expect(scoped.value.session.message.list(ids.session)).toEqual([])
    await scoped.value.session.message.sync(ids.session)
    expect(scoped.value.session.message.list(ids.session)).toHaveLength(1)
    delta()
    expect(scoped.value.session.message.list(ids.session)[0]).toMatchObject({ id: ids.message })
    scoped.value.session.evict(ids.session)
    expect(scoped.value.session.message.list(ids.session)).toEqual([])
    scoped.dispose()
  })

  test("coalesces invalidations that arrive before a queued replacement begins", async () => {
    const transport = new TestTransport()
    const first = new Gate<Response>(), second = new Gate<Response>()
    transport.when((request) => request.url.pathname === "/api/session", () => transport.count("/api/session") === 1 ? first.promise : second.promise)
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: new TestEvents() }))
    const initial = scoped.value.session.sync()
    await transport.receipt("/api/session")
    scoped.value.session.invalidate()
    const replacement = scoped.value.session.sync()
    scoped.value.session.invalidate()
    const shared = scoped.value.session.sync()
    first.resolve(json({ data: [] }))
    await transport.receiptAfter(1, "/api/session")
    second.resolve(json({ data: [] }))
    await Promise.all([initial, replacement, shared])
    expect(transport.count("/api/session")).toBe(2)
    scoped.dispose()
  })

  test("does not restore evicted heavy history when a shared active read settles", async () => {
    const transport = new TestTransport(); const active = new Gate<Response>()
    transport.when((request) => request.url.pathname === "/api/session/active", active.promise)
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: new TestEvents() }))
    const read = scoped.value.session.active.sync()
    await transport.receipt("/api/session/active")
    scoped.value.session.evict(ids.session)
    active.resolve(json({ [ids.session]: { type: "running" } }))
    await read
    expect(scoped.value.session.message.list(ids.session)).toEqual([])
    expect(scoped.value.session.inbox.list(ids.session)).toEqual([])
    expect(scoped.value.session.permission.list(ids.session)).toEqual([])
    expect(scoped.value.session.form.list(ids.session)).toEqual([])
    expect(scoped.value.session.active.get(ids.session)).toBe("running")
    scoped.dispose()
  })
})
