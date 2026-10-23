import { createData } from "@bymorning/client/solid"
import * as SDK from "@bymorning/client"
import { describe, expect, test } from "vitest"
import { Gate, TestEvents, TestTransport, admission, ids, json, message, owner } from "./fixture.js"

const setup = () => {
  const transport = new TestTransport(),
    events = new TestEvents(),
    response = new Gate<Response>()
  transport.when((r) => r.url.pathname.endsWith("/prompt") || r.url.pathname.endsWith("/compact"), response.promise)
  const scoped = owner(() =>
    createData({ api: () => transport.api, workspace: ids.workspace, event: events, report: () => {} }),
  )
  const emit = (type: string, data: object) =>
    events.emit({
      id: crypto.randomUUID(),
      type,
      created: Date.now(),
      data: { sessionID: ids.session, ...data },
    } as SDK.WorkspaceEventItem)
  return { transport, response, emit, ...scoped }
}
const input = { sessionID: ids.session, id: ids.message, text: "draft" }
const item = { ...admission(), type: "user", payload: { text: "accepted" }, delivery: "steer" }

describe("admission evidence and request identity", () => {
  test.each(["http-first", "event-first", "promoted-first", "evicted"])(
    "converges for %s admission ordering",
    async (order) => {
      const { value, transport, response, emit, dispose } = setup()
      const pending = value.session.prompt(input)
      await transport.receipt(`/api/session/${ids.session}/prompt`)
      if (order === "event-first") emit("session.input.admitted", { item })
      if (order === "promoted-first") emit("session.input.promoted", { inboxID: ids.message, message: message() })
      if (order === "evicted") {
        value.session.evict(ids.session)
        emit("session.input.promoted", { inboxID: ids.message, message: message() })
      }
      response.resolve(json({ ...admission(), text: "accepted", delivery: "steer" }, 202))
      await pending
      expect(value.session.submission.list(ids.session)).toEqual([])
      if (order === "http-first" || order === "event-first") {
        expect(value.session.inbox.list(ids.session)).toMatchObject([
          { id: ids.message, payload: { text: "accepted" }, delivery: "steer", createdAt: expect.any(Date) },
        ])
        emit("session.input.promoted", { inboxID: ids.message, message: message() })
      }
      expect(value.session.inbox.list(ids.session)).toEqual([])
      expect(value.session.message.list(ids.session)).toHaveLength(order === "evicted" ? 0 : 1)
      dispose()
    },
  )

  test("retired visible submission still rejects a conflicting in-flight ID and accepts stable-key equivalent input", async () => {
    const { value, response, emit, dispose } = setup()
    const pending = value.session.prompt({ ...input, metadata: { a: 1, b: 2 } })
    emit("session.input.admitted", { item })
    expect(value.session.submission.list(ids.session)).toEqual([])
    await expect(value.session.prompt({ ...input, text: "different" })).rejects.toSatisfy(
      SDK.isSessionPromptConflictError,
    )
    const matching = value.session.prompt({
      metadata: { b: 2, a: 1 },
      text: "draft",
      id: ids.message,
      sessionID: ids.session,
    })
    expect(matching).toBe(pending)
    response.resolve(json(admission(), 202))
    await pending
    dispose()
  })

  test("event acknowledgement survives HTTP rejection without resurrecting failure", async () => {
    const { value, response, emit, dispose } = setup()
    const pending = value.session.prompt(input)
    const rejection = expect(pending).rejects.toBeDefined()
    emit("session.input.admitted", { item })
    response.reject(new Error("lost HTTP response"))
    await rejection
    expect(value.session.submission.list(ids.session)).toEqual([])
    expect(value.session.inbox.list(ids.session)).toHaveLength(1)
    dispose()
  })

  test("uncertain same-ID retry returns to sending and cannot be dismissed", async () => {
    const { value, transport, response, dispose } = setup()
    const first = value.session.prompt(input)
    const rejection = expect(first).rejects.toBeDefined()
    response.reject(new Error("offline"))
    await rejection
    const accepted = new Gate<Response>()
    transport.when((r) => r.url.pathname.endsWith("/prompt"), accepted.promise)
    const saved = value.session.submission.list(ids.session)[0]!
    const retry = value.session.prompt(saved.input as SDK.SessionPromptInput)
    expect(value.session.submission.list(ids.session)[0]?.state.state).toBe("sending")
    value.session.submission.dismiss(ids.session, ids.message)
    expect(value.session.submission.list(ids.session)).toHaveLength(1)
    accepted.resolve(json(admission(), 202))
    await retry
    expect(value.session.submission.list(ids.session)).toEqual([])
    dispose()
  })

  test("absence preserves uncertainty, canonical Message read retires it and supersedes stale Inbox", async () => {
    const { value, transport, response, dispose } = setup()
    const pending = value.session.prompt(input)
    const rejection = expect(pending).rejects.toBeDefined()
    response.reject(new Error("offline"))
    await rejection
    await value.session.inbox.sync(ids.session)
    await value.session.message.sync(ids.session)
    expect(value.session.submission.list(ids.session)[0]?.state.state).toBe("uncertain")
    transport.when((r) => r.url.pathname.endsWith("/message"), json({ data: [message()], cursor: {} }))
    value.session.message.invalidate(ids.session)
    await value.session.message.sync(ids.session)
    expect(value.session.submission.list(ids.session)).toEqual([])
    transport.when((r) => r.url.pathname.endsWith("/inbox"), json({ data: [item] }))
    value.session.inbox.invalidate(ids.session)
    await value.session.inbox.sync(ids.session)
    expect(value.session.inbox.list(ids.session)).toEqual([])
    dispose()
  })

  test("compaction coalescing uses the returned canonical ID and start removes its Inbox", async () => {
    const { value, response, emit, dispose } = setup()
    const canonicalID = ids.other as unknown as SDK.SessionCompactOutput["id"]
    const pending = value.session.compact({ sessionID: ids.session, id: ids.message })
    response.resolve(json(admission(canonicalID), 202))
    await pending
    expect(value.session.submission.list(ids.session)).toEqual([])
    expect(value.session.inbox.list(ids.session)).toMatchObject([
      { id: canonicalID, type: "compaction", payload: {}, delivery: "queue" },
    ])
    emit("session.compaction.started", {
      message: {
        ...message(canonicalID),
        type: "compaction",
        reason: "manual",
        status: "running",
        summary: "",
        recent: "",
      },
    })
    expect(value.session.inbox.list(ids.session)).toEqual([])
    expect(value.session.message.get(ids.session, canonicalID)?.type).toBe("compaction")
    dispose()
  })

  test("a synchronous SDK accessor throw follows the returned Promise failure path", async () => {
    const cause = new Error("accessor unavailable")
    const scoped = owner(() =>
      createData({
        api: () => {
          throw cause
        },
        workspace: ids.workspace,
        event: new TestEvents(),
        report: () => {},
      }),
    )
    const pending = scoped.value.session.prompt(input)
    expect(scoped.value.session.submission.list(ids.session)[0]?.state.state).toBe("sending")
    await expect(pending).rejects.toBe(cause)
    expect(scoped.value.session.submission.list(ids.session)[0]?.state.state).toBe("uncertain")
    scoped.dispose()
  })
})
