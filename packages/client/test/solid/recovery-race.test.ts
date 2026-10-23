import { createData } from "@bymorning/client/solid"
import type * as SDK from "@bymorning/client"
import { describe, expect, test } from "vitest"
import { Gate, TestEvents, TestTransport, detail, ids, json, message, owner, session } from "./fixture.js"

const usage = detail().usage
const assistant = (text = "") => ({
  ...message(),
  type: "assistant",
  sequence: 10,
  agent: "agent",
  model: session().model,
  content: [{ type: "text", id: "text", text }],
  usage,
  time: { created: session().createdAt },
})
const emit = (events: TestEvents, type: string, data: object) =>
  events.emit({
    id: crypto.randomUUID(),
    type,
    created: Date.now(),
    data: { sessionID: ids.session, ...data },
  } as SDK.WorkspaceEventItem)
const setup = () => {
  const transport = new TestTransport(),
    events = new TestEvents()
  const scoped = owner(() =>
    createData({ api: () => transport.api, workspace: ids.workspace, event: events, report: () => {} }),
  )
  return { transport, events, ...scoped }
}

describe("resource and retained-window ownership", () => {
  test("disposing fences deferred global resource reads", async () => {
    const { value, transport, dispose } = setup()
    const gates = [new Gate<Response>(), new Gate<Response>(), new Gate<Response>()]
    for (const [index, path] of ["project", "agent", "models"].entries())
      transport.when((r) => r.url.pathname === `/api/${path}`, gates[index]!.promise)
    const reads = [value.project.sync(), value.agent.sync(), value.model.sync()]
    await Promise.all(["project", "agent", "models"].map((path) => transport.receipt(`/api/${path}`)))
    value.dispose()
    gates[0]!.resolve(json([{ id: session().projectID, name: "late", time_created: 1, time_updated: 1 }]))
    gates[1]!.resolve(json([]))
    gates[2]!.resolve(json([]))
    await Promise.allSettled(reads)
    expect(value.project.list()).toEqual([])
    expect(value.agent.list()).toEqual([])
    expect(value.model.list()).toEqual([])
    dispose()
  })

  test("inventory refresh rebuilds retained page depth in server order and overlays live removal", async () => {
    const { value, transport, events, dispose } = setup()
    let refresh = false
    const gate = new Gate<Response>()
    const third = "00000000-0000-4000-8000-000000000030" as typeof ids.session
    transport.when(
      (r) => r.url.pathname === "/api/session",
      (r) => {
        const cursor = r.url.searchParams.get("cursor")
        if (refresh) return cursor ? gate.promise : json({ data: [session(ids.other)], cursor: "new" })
        return json(cursor ? { data: [session(ids.other)], cursor: "oldtail" } : { data: [session()], cursor: "old" })
      },
    )
    await value.session.sync()
    await value.session.load()
    refresh = true
    value.session.invalidate()
    const read = value.session.sync()
    await transport.receipt((r) => r.url.searchParams.get("cursor") === "new")
    emit(events, "session.deleted", {})
    gate.resolve(json({ data: [session(), session(third)], cursor: "tail" }))
    await read
    expect(value.session.list().map((row) => row.id)).toEqual([ids.other, third])
    expect(value.session.more()).toBe(true)
    dispose()
  })

  test("a rejected queued replacement is retryable without another invalidation", async () => {
    const { value, transport, dispose } = setup()
    const first = new Gate<Response>(),
      second = new Gate<Response>()
    transport.when(
      (r) => r.url.pathname === "/api/session",
      () =>
        transport.count("/api/session") === 1
          ? first.promise
          : transport.count("/api/session") === 2
            ? second.promise
            : json({ data: [session()] }),
    )
    const initial = value.session.sync()
    await transport.receipt("/api/session")
    value.session.invalidate()
    const queued = value.session.sync()
    const failure = expect(queued).rejects.toBeDefined()
    first.resolve(json({ data: [] }))
    await transport.receiptAfter(1, "/api/session")
    second.reject(new Error("offline"))
    await Promise.all([initial, failure])
    await value.session.sync()
    expect(transport.count("/api/session")).toBe(3)
    expect(value.session.list()).toHaveLength(1)
    dispose()
  })

  test("a pre-eviction queued read cannot reacquire the record; a later explicit read can", async () => {
    const { value, transport, dispose } = setup()
    const first = new Gate<Response>()
    transport.when(
      (r) => r.url.pathname === `/api/session/${ids.session}`,
      () => (transport.count(`/api/session/${ids.session}`) === 1 ? first.promise : json(detail())),
    )
    const initial = value.session.detail.sync(ids.session)
    await transport.receipt(`/api/session/${ids.session}`)
    value.session.detail.invalidate(ids.session)
    const queued = value.session.detail.sync(ids.session)
    const stale = expect(queued).rejects.toMatchObject({ name: "AbortError" })
    value.session.evict(ids.session)
    const fresh = value.session.detail.sync(ids.session)
    await fresh
    expect(value.session.get(ids.session)?.id).toBe(ids.session)
    first.resolve(json(detail()))
    await Promise.all([initial, stale])
    expect(transport.count(`/api/session/${ids.session}`)).toBe(2)
    expect(value.session.get(ids.session)?.id).toBe(ids.session)
    dispose()
  })

  test("streaming cannot discard independent reads, unrelated history, or settled-request overlays", async () => {
    const { value, transport, events, dispose } = setup()
    emit(events, "session.execution.started", { message: assistant() })
    const gates = Object.fromEntries(
      ["detail", "message", "inbox", "permission", "form"].map((key) => [key, new Gate<Response>()]),
    )
    for (const key of Object.keys(gates))
      transport.when(
        (r) => r.url.pathname === `/api/session/${ids.session}${key === "detail" ? "" : `/${key}`}`,
        gates[key]!.promise,
      )
    const reads = [
      value.session.detail.sync(ids.session),
      value.session.message.sync(ids.session),
      value.session.inbox.sync(ids.session),
      value.session.permission.sync(ids.session),
      value.session.form.sync(ids.session),
    ]
    await Promise.all(
      Object.keys(gates).map((key) =>
        transport.receipt(`/api/session/${ids.session}${key === "detail" ? "" : `/${key}`}`),
      ),
    )
    emit(events, "session.text.delta", { messageID: ids.message, partID: "text", text: "live" })
    emit(events, "permission.v2.replied", { requestID: "per_removed", reply: "once" })
    emit(events, "form.cancelled", { id: "frm_removed" })
    emit(events, "session.input.promoted", { inboxID: ids.other, message: message(ids.other as never, 9) })
    gates.detail!.resolve(json(detail()))
    gates.message!.resolve(
      json({
        data: [assistant("stale"), message("00000000-0000-4000-8000-000000000010" as never, 1)],
        cursor: { next: "older" },
      }),
    )
    gates.inbox!.resolve(
      json({
        data: [ids.other, "00000000-0000-4000-8000-000000000011"].map((id) => ({
          id,
          sessionID: ids.session,
          admittedSequence: 2,
          createdAt: session().createdAt,
          type: "user",
          payload: { text: "queued" },
          delivery: "queue",
        })),
      }),
    )
    gates.permission!.resolve(
      json(["per_removed", "per_kept"].map((id) => ({ id, sessionID: ids.session, action: "read", resources: [] }))),
    )
    gates.form!.resolve(
      json(
        ["frm_removed", "frm_kept"].map((id) => ({
          id,
          sessionID: ids.session,
          title: "Form",
          fields: [{ key: "answer", type: "string" }],
        })),
      ),
    )
    await Promise.all(reads)
    expect(value.session.get(ids.session)?.usage).toEqual(usage)
    expect(value.session.message.list(ids.session).map((row) => row.sequence)).toEqual([1, 9, 10])
    expect(value.session.message.get(ids.session, ids.message)).toMatchObject({ content: [{ text: "live" }] })
    expect(value.session.message.more(ids.session)).toBe(true)
    expect(value.session.inbox.list(ids.session).map((row) => row.id)).toEqual(["00000000-0000-4000-8000-000000000011"])
    expect(value.session.permission.list(ids.session).map((row) => row.id)).toEqual(["per_kept"])
    expect(value.session.form.list(ids.session).map((row) => row.id)).toEqual(["frm_kept"])
    dispose()
  })

  test.each([false, true])("older-page loading clears during live output (reject=%s)", async (reject) => {
    const { value, transport, events, dispose } = setup()
    const older = new Gate<Response>()
    transport.when(
      (r) => r.url.pathname.endsWith("/message"),
      (r) =>
        r.url.searchParams.has("cursor") ? older.promise : json({ data: [assistant()], cursor: { next: "older" } }),
    )
    await value.session.message.sync(ids.session)
    const load = value.session.message.load(ids.session)
    const outcome = reject ? expect(load).rejects.toBeDefined() : load
    await transport.receipt((r) => r.url.searchParams.get("cursor") === "older")
    emit(events, "session.text.delta", { messageID: ids.message, partID: "text", text: "live" })
    if (reject) older.reject(new Error("offline"))
    else older.resolve(json({ data: [message(ids.other as never, 1)], cursor: {} }))
    await outcome
    expect(value.session.message.loading(ids.session)).toBe(false)
    expect(value.session.message.get(ids.session, ids.message)).toMatchObject({ content: [{ text: "live" }] })
    if (!reject) expect(value.session.message.list(ids.session).map((row) => row.sequence)).toEqual([1, 10])
    dispose()
  })

  test("a disconnected nonoverlapping head replaces the history window and fences its old load", async () => {
    const { value, transport, dispose } = setup()
    let refresh = false
    const old = new Gate<Response>()
    transport.when(
      (r) => r.url.pathname.endsWith("/message"),
      (r) => {
        const cursor = r.url.searchParams.get("cursor")
        if (cursor === "old") return old.promise
        if (cursor === "gap") return json({ data: [message(ids.other as never, 70)], cursor: { next: "rest" } })
        return json({
          data: [message(refresh ? ("00000000-0000-4000-8000-000000000021" as never) : ids.message, refresh ? 100 : 2)],
          cursor: { next: refresh ? "gap" : "old" },
        })
      },
    )
    await value.session.message.sync(ids.session)
    const stale = value.session.message.load(ids.session)
    await transport.receipt((r) => r.url.searchParams.get("cursor") === "old")
    refresh = true
    value.session.message.invalidate(ids.session)
    await value.session.message.sync(ids.session)
    expect(value.session.message.list(ids.session).map((row) => row.sequence)).toEqual([100])
    await value.session.message.load(ids.session)
    old.resolve(json({ data: [message(ids.message, 1)], cursor: {} }))
    await stale
    expect(value.session.message.list(ids.session).map((row) => row.sequence)).toEqual([70, 100])
    expect(value.session.message.more(ids.session)).toBe(true)
    dispose()
  })

  test("a complete head removes absent old records rather than preserving a fictitious tail", async () => {
    const { value, transport, dispose } = setup()
    let first = true
    transport.when(
      (r) => r.url.pathname.endsWith("/message"),
      () => json({ data: first ? [message()] : [], cursor: {} }),
    )
    await value.session.message.sync(ids.session)
    first = false
    value.session.message.invalidate(ids.session)
    await value.session.message.sync(ids.session)
    expect(value.session.message.list(ids.session)).toEqual([])
    dispose()
  })

  test("fully loaded inventory refresh reaches EOF and removes missed offline deletions", async () => {
    const { value, transport, events, dispose } = setup()
    let refresh = false
    transport.when(
      (r) => r.url.pathname === "/api/session",
      (r) =>
        json(
          r.url.searchParams.has("cursor")
            ? { data: refresh ? [] : [session(ids.other)] }
            : { data: [session()], cursor: "next" },
        ),
    )
    await value.session.sync()
    await value.session.load()
    expect(value.session.list()).toHaveLength(2)
    refresh = true
    value.session.invalidate()
    await value.session.sync()
    expect(value.session.list().map((row) => row.id)).toEqual([ids.session])
    expect(value.session.more()).toBe(false)
    emit(events, "session.created", { session: { ...session(ids.other), parentID: ids.session } })
    expect(value.session.list()).toHaveLength(1)
    emit(events, "session.updated", { session: { ...session(), archivedAt: session().createdAt } })
    expect(value.session.list()).toEqual([])
    emit(events, "session.updated", { session: session() })
    expect(value.session.list()).toHaveLength(1)
    dispose()
  })

  test("summary restoration and Run events overlay in-flight detail and active snapshots", async () => {
    const { value, transport, events, dispose } = setup()
    await value.session.detail.sync(ids.session)
    emit(events, "session.updated", { session: { ...session(), archivedAt: session().createdAt } })
    expect(value.session.get(ids.session)?.archivedAt).toBeInstanceOf(Date)
    const held = new Gate<Response>(),
      active = new Gate<Response>()
    transport.when((r) => r.url.pathname === `/api/session/${ids.session}`, held.promise)
    transport.when((r) => r.url.pathname === "/api/session/active", active.promise)
    const reads = [value.session.detail.sync(ids.session), value.session.active.sync()]
    await transport.receipt("/api/session/active")
    emit(events, "session.updated", { session: { ...session(), title: "restored" } })
    emit(events, "session.run.started", {})
    held.resolve(json({ ...detail(), title: "stale", archivedAt: session().createdAt }))
    active.resolve(json({}))
    await Promise.all(reads)
    expect(value.session.get(ids.session)).toMatchObject({ title: "restored", usage })
    expect(value.session.get(ids.session)?.archivedAt).toBeUndefined()
    expect(value.session.active.get(ids.session)).toBe("running")
    emit(events, "session.deleted", {})
    emit(events, "session.execution.started", { message: assistant() })
    emit(events, "session.updated", { session: session() })
    expect(value.session.list()).toEqual([])
    expect(value.session.get(ids.session)).toBeUndefined()
    expect(value.session.active.get(ids.session)).toBeUndefined()
    expect(value.session.message.list(ids.session)).toEqual([])
    dispose()
  })
})
