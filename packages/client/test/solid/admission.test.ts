import { createData } from "@bymorning/client/solid"
import * as SDK from "@bymorning/client"
import { describe, expect, test } from "vitest"

import { Gate, TestEvents, TestTransport, admission, ids, json, owner } from "./fixture.js"

describe("submission admission", () => {
  test("creates synchronously, shares matching IDs, and acknowledges a 202 response", async () => {
    const transport = new TestTransport()
    const accepted = new Gate<Response>()
    transport.when((request) => request.url.pathname.endsWith("/prompt"), accepted.promise)
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: new TestEvents(), report: () => {} }))
    const input = { sessionID: ids.session, id: ids.message, text: "hello" }
    const one = scoped.value.session.prompt(input)
    const two = scoped.value.session.prompt(input)
    expect(scoped.value.session.submission.list(ids.session)).toMatchObject([{ id: ids.message, state: { state: "sending" }, input }])
    await transport.receipt(`/api/session/${ids.session}/prompt`)
    expect(transport.count(`/api/session/${ids.session}/prompt`)).toBe(1)
    accepted.resolve(json(admission(), 202))
    await expect(Promise.all([one, two])).resolves.toHaveLength(2)
    expect(scoped.value.session.submission.list(ids.session)).toEqual([])
    scoped.dispose()
  })

  test("keeps known SDK rejections failed and makes transport ambiguity uncertain for same-ID retry", async () => {
    const transport = new TestTransport()
    let calls = 0
    transport.when((request) => request.url.pathname.endsWith("/prompt"), () => {
      calls++
      return calls === 1 ? Promise.reject(new Error("connection dropped")) : json(admission(), 202)
    })
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: new TestEvents(), report: () => {} }))
    const input = { sessionID: ids.session, id: ids.message, text: "retry" }
    await expect(scoped.value.session.prompt(input)).rejects.toBeDefined()
    expect(scoped.value.session.submission.list(ids.session)).toMatchObject([{ id: ids.message, state: { state: "uncertain" }, input }])
    await expect(scoped.value.session.prompt(input)).resolves.toMatchObject({ id: ids.message })
    expect(calls).toBe(2)
    scoped.dispose()
  })

  test("does not replace an in-flight submission when its ID has different input", async () => {
    const transport = new TestTransport()
    const accepted = new Gate<Response>()
    transport.when((request) => request.url.pathname.endsWith("/prompt"), accepted.promise)
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: new TestEvents() }))
    const first = scoped.value.session.prompt({ sessionID: ids.session, id: ids.message, text: "first" })
    await expect(scoped.value.session.prompt({ sessionID: ids.session, id: ids.message, text: "second" })).rejects.toSatisfy(SDK.isSessionPromptConflictError)
    expect(scoped.value.session.submission.list(ids.session)[0]?.input).toMatchObject({ text: "first" })
    accepted.resolve(json(admission(), 202))
    await first
    scoped.dispose()
  })

  test("rejects a prompt/compaction same-ID collision as the generated compaction conflict", async () => {
    const transport = new TestTransport()
    const accepted = new Gate<Response>()
    transport.when((request) => request.url.pathname.endsWith("/prompt"), accepted.promise)
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: new TestEvents() }))
    const prompt = scoped.value.session.prompt({ sessionID: ids.session, id: ids.message, text: "prompt" })
    await expect(scoped.value.session.compact({ sessionID: ids.session, id: ids.message })).rejects.toSatisfy(SDK.isSessionCompactionConflictError)
    accepted.resolve(json(admission(), 202))
    await prompt
    scoped.dispose()
  })

  test("coalesces omitted-ID compactions per Session and retires the one local submission", async () => {
    const transport = new TestTransport()
    const accepted = new Gate<Response>()
    transport.when((request) => request.url.pathname.endsWith("/compact"), accepted.promise)
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: new TestEvents() }))
    const one = scoped.value.session.compact({ sessionID: ids.session })
    const two = scoped.value.session.compact({ sessionID: ids.session })
    const [submission] = scoped.value.session.submission.list(ids.session)
    expect(submission).toMatchObject({ type: "compaction", state: { state: "sending" } })
    await transport.receipt(`/api/session/${ids.session}/compact`)
    expect(transport.count(`/api/session/${ids.session}/compact`)).toBe(1)
    accepted.resolve(json(admission(submission!.id), 202))
    await expect(Promise.all([one, two])).resolves.toHaveLength(2)
    expect(scoped.value.session.submission.list(ids.session)).toEqual([])
    scoped.dispose()
  })

  test("retains an uncertain submission across selected-session eviction", async () => {
    const transport = new TestTransport()
    transport.when((request) => request.url.pathname.endsWith("/prompt"), Promise.reject(new Error("connection lost")))
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: new TestEvents(), report: () => {} }))
    await expect(scoped.value.session.prompt({ sessionID: ids.session, id: ids.message, text: "retain" })).rejects.toBeDefined()
    scoped.value.session.evict(ids.session)
    expect(scoped.value.session.submission.list(ids.session)).toMatchObject([{ id: ids.message, state: { state: "uncertain" }, input: { text: "retain" } }])
    scoped.dispose()
  })

  test("a positive Inbox read acknowledges a local uncertain prompt without rewriting its user input", async () => {
    const transport = new TestTransport()
    transport.when((request) => request.url.pathname.endsWith("/prompt"), Promise.reject(new Error("connection lost")))
    transport.when((request) => request.url.pathname.endsWith("/inbox"), json({ data: [{ id: ids.message, sessionID: ids.session, admittedSequence: 1, createdAt: "2025-01-01T00:00:00.000Z", type: "user", payload: { text: "canonical inbox text" }, delivery: "queue" }] }))
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: new TestEvents(), report: () => {} }))
    await expect(scoped.value.session.prompt({ sessionID: ids.session, id: ids.message, text: "local text" })).rejects.toBeDefined()
    await scoped.value.session.inbox.sync(ids.session)
    expect(scoped.value.session.submission.list(ids.session)).toEqual([])
    expect(scoped.value.session.inbox.list(ids.session)).toMatchObject([{ id: ids.message, payload: { text: "canonical inbox text" } }])
    scoped.dispose()
  })

  test("aborts a pending prompt on Data disposal and rejects without late local publication", async () => {
    const transport = new TestTransport()
    const observed = new Gate<AbortSignal>()
    const abort = new DOMException("Aborted", "AbortError")
    transport.when((request) => request.url.pathname.endsWith("/prompt"), (request) => new Promise<Response>((_resolve, reject) => {
      const signal = request.init.signal!
      observed.resolve(signal)
      signal.addEventListener("abort", () => reject(abort), { once: true })
    }))
    const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: new TestEvents(), report: () => {} }))
    const pending = scoped.value.session.prompt({ sessionID: ids.session, id: ids.message, text: "cancel" })
    const signal = await observed.promise
    scoped.value.dispose()
    expect(signal.aborted).toBe(true)
    await expect(pending).rejects.toBe(abort)
    expect(scoped.value.session.submission.list(ids.session)).toEqual([])
    scoped.dispose()
  })
})
