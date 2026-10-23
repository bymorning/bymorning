import { createData } from "@bymorning/client/solid"
import { describe, expect, test } from "vitest"

import { TestEvents, TestTransport, ids, json, message, owner, session } from "./fixture.js"

describe("opaque pages", () => {
  test("message windows deduplicate overlap and expose ascending sequence", async () => {
    const transport = new TestTransport()
    transport.when((request) => request.url.pathname.endsWith("/message"), json({ data: [message("00000000-0000-4000-8000-000000000012" as never, 2), message("00000000-0000-4000-8000-000000000013" as never, 3)], cursor: { next: "older" } }))
    transport.when((request) => request.url.pathname.endsWith("/message") && request.url.searchParams.get("cursor") === "older", json({ data: [message("00000000-0000-4000-8000-000000000011" as never, 1), message("00000000-0000-4000-8000-000000000012" as never, 2)], cursor: {} }))
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: new TestEvents() }))
    await scoped.value.session.message.sync(ids.session)
    await Promise.all([scoped.value.session.message.load(ids.session), scoped.value.session.message.load(ids.session)])
    expect(transport.count(`/api/session/${ids.session}/message`)).toBe(2)
    expect(scoped.value.session.message.list(ids.session).map((row) => row.sequence)).toEqual([1, 2, 3])
    expect(scoped.value.session.message.more(ids.session)).toBe(false)
    scoped.dispose()
  })

  test("session pages retain server order and shared active state remains unknown until synced", async () => {
    const transport = new TestTransport()
    transport.when((request) => request.url.pathname === "/api/session", (request) => json(request.url.searchParams.get("cursor") === "older" ? { data: [session(ids.other)] } : { data: [session()], cursor: "older" }))
    transport.when((request) => request.url.pathname === "/api/session/active", json({ [ids.session]: { type: "running" } }))
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: new TestEvents() }))
    expect(scoped.value.session.active.get(ids.session)).toBeUndefined()
    await scoped.value.session.sync()
    await scoped.value.session.load()
    expect(scoped.value.session.list().map((row) => row.id)).toEqual([ids.session, ids.other])
    await scoped.value.session.active.sync()
    expect(scoped.value.session.active.get(ids.session)).toBe("running")
    scoped.dispose()
  })

  test("after refresh, load follows the oldest retained Message cursor rather than resetting to the head cursor", async () => {
    const transport = new TestTransport()
    let head = 0
    transport.when((request) => request.url.pathname.endsWith("/message"), (request) => {
      const cursor = request.url.searchParams.get("cursor")
      if (cursor === "middle") return json({ data: [message("00000000-0000-4000-8000-000000000010" as never, 2)], cursor: { next: "oldest" } })
      if (cursor === "oldest") return json({ data: [message("00000000-0000-4000-8000-000000000009" as never, 1)], cursor: {} })
      head++
      return json({ data: [message("00000000-0000-4000-8000-000000000012" as never, 4)], cursor: { next: "middle" } })
    })
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: new TestEvents() }))
    await scoped.value.session.message.sync(ids.session)
    await scoped.value.session.message.load(ids.session)
    scoped.value.session.message.invalidate(ids.session)
    await scoped.value.session.message.sync(ids.session)
    const requestAt = transport.requests.length
    await scoped.value.session.message.load(ids.session)
    expect(transport.requests.slice(requestAt).find((request) => request.url.searchParams.get("cursor") === "oldest")).toBeDefined()
    expect(scoped.value.session.message.list(ids.session).map((row) => row.sequence)).toEqual([1, 2, 4])
    expect(head).toBe(2)
    scoped.dispose()
  })

  test("an invalid Message cursor is cleared without an automatic recovery read", async () => {
    const transport = new TestTransport()
    transport.when((request) => request.url.pathname.endsWith("/message"), json({ data: [message()], cursor: { next: "expired" } }))
    transport.when((request) => request.url.pathname.endsWith("/message") && request.url.searchParams.get("cursor") === "expired", json({ _tag: "Session.InvalidCursorError", message: "expired" }, 400))
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: new TestEvents(), report: () => {} }))
    await scoped.value.session.message.sync(ids.session)
    const before = transport.requests.length
    await expect(scoped.value.session.message.load(ids.session)).rejects.toSatisfy((cause: unknown) => "_tag" in (cause as object) && (cause as { _tag: string })._tag === "Session.InvalidCursorError")
    expect(transport.requests).toHaveLength(before + 1)
    expect(scoped.value.session.message.more(ids.session)).toBe(false)
    await scoped.value.session.message.sync(ids.session)
    expect(transport.requests).toHaveLength(before + 2)
    scoped.dispose()
  })
})
