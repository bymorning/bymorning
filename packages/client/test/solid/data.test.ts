import { createData } from "@bymorning/client/solid"
import { describe, expect, test } from "vitest"

import { Gate, TestEvents, TestTransport, ids, json, message, owner, session } from "./fixture.js"

describe("explicit Data synchronization", () => {
  test("does not read until the application explicitly syncs", () => {
    const transport = new TestTransport()
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: new TestEvents() }))
    expect(transport.requests).toEqual([])
    scoped.dispose()
  })

  test("invalidate never fetches, including while a read is pending, and the next sync serializes one replacement", async () => {
    const transport = new TestTransport()
    const first = new Gate<Response>()
    const second = new Gate<Response>()
    transport.when((request) => request.url.pathname === "/api/session", () => transport.count("/api/session") === 1 ? first.promise : second.promise)
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: new TestEvents() }))

    const initial = scoped.value.session.sync()
    await transport.receipt("/api/session")
    scoped.value.session.invalidate()
    expect(transport.count("/api/session")).toBe(1)
    const replacement = scoped.value.session.sync()
    expect(transport.count("/api/session")).toBe(1)
    first.resolve(json({ data: [session()], cursor: "older" }))
    await transport.receiptAfter(1, "/api/session")
    expect(scoped.value.session.list().map((entry) => entry.id)).toEqual([ids.session])
    second.resolve(json({ data: [session(ids.other)] }))
    await Promise.all([initial, replacement])
    expect(transport.count("/api/session")).toBe(2)
    expect(scoped.value.session.list().map((entry) => entry.id)).toEqual([ids.other])
    scoped.dispose()
  })

  test("eviction prevents a late selected-session response publishing, while retaining submissions", async () => {
    const transport = new TestTransport()
    const detail = new Gate<Response>()
    transport.when((request) => request.url.pathname === `/api/session/${ids.session}`, detail.promise)
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: new TestEvents() }))
    const pending = scoped.value.session.detail.sync(ids.session)
    await transport.receipt(`/api/session/${ids.session}`)
    scoped.value.session.evict(ids.session)
    detail.resolve(json({ ...session(), usage: { cost: 0, costComplete: true, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } } }))
    await pending.catch(() => undefined)
    expect(scoped.value.session.get(ids.session)).toBeUndefined()
    scoped.dispose()
  })

  test("eviction prevents a pending older Message page from resurrecting heavy session state", async () => {
    const transport = new TestTransport()
    const older = new Gate<Response>()
    transport.when((request) => request.url.pathname.endsWith("/message") && request.url.searchParams.get("cursor") === "older", older.promise)
    transport.when((request) => request.url.pathname.endsWith("/message"), json({ data: [message()], cursor: { next: "older" } }))
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: new TestEvents() }))
    await scoped.value.session.message.sync(ids.session)
    const loading = scoped.value.session.message.load(ids.session)
    await transport.receipt((request) => request.url.pathname.endsWith("/message") && request.url.searchParams.get("cursor") === "older")
    scoped.value.session.evict(ids.session)
    older.resolve(json({ data: [], cursor: {} }))
    await loading.catch(() => undefined)
    expect(scoped.value.session.message.list(ids.session)).toEqual([])
    expect(scoped.value.session.message.more(ids.session)).toBe(false)
    scoped.dispose()
  })
})
