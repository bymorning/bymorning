import { createData } from "@bymorning/client/solid"
import type * as SDK from "@bymorning/client"
import { describe, expect, test } from "vitest"
import { TestEvents, TestTransport, detail, ids, json, message, owner, session } from "./fixture.js"

const assistant = () => ({
  ...message(),
  type: "assistant",
  agent: "agent",
  model: session().model,
  content: [],
  usage: detail().usage,
  time: { created: session().createdAt },
})
const setup = () => {
  const transport = new TestTransport(),
    events = new TestEvents()
  const scoped = owner(() => createData({ api: () => transport.api, workspace: ids.workspace, event: events }))
  let created = 1000
  const emit = (type: string, data: object) => {
    const event = {
      id: crypto.randomUUID(),
      type,
      created: ++created,
      data: { sessionID: ids.session, messageID: ids.message, ...data },
    } as Exclude<SDK.WorkspaceEventItem, { type: "server.connected" }>
    events.emit(event)
    return event
  }
  return { transport, events, emit, ...scoped }
}

describe("live projection monotonicity", () => {
  test("routes fallback models, clears retry, and normalizes streamed/retry dates", () => {
    const { value, emit, dispose } = setup()
    emit("session.execution.started", { message: assistant() })
    emit("session.retry.scheduled", {
      attempt: 2,
      at: session().createdAt,
      error: { _tag: "SessionError.InternalError", message: "retry" },
    })
    expect(value.session.message.get(ids.session, ids.message)).toMatchObject({
      retry: { attempt: 2, at: new Date(session().createdAt) },
    })
    emit("session.execution.model.routed", {
      requestedModel: session().model,
      model: { provider: "fallback", id: "other" },
    })
    expect(value.session.message.get(ids.session, ids.message)).toMatchObject({
      model: { provider: "fallback" },
      requestedModel: session().model,
    })
    expect(
      (
        value.session.message.get(ids.session, ids.message) as Extract<
          SDK.MessageListOutput["data"][number],
          { type: "assistant" }
        >
      ).retry,
    ).toBeUndefined()
    emit("session.execution.model.routed", {
      requestedModel: session().model,
      model: { ...session().model, variant: "default" },
    })
    expect(
      (
        value.session.message.get(ids.session, ids.message) as Extract<
          SDK.MessageListOutput["data"][number],
          { type: "assistant" }
        >
      ).requestedModel,
    ).toBeUndefined()
    const streamed = emit("session.execution.streamed", { attempt: 2 })
    expect(value.session.message.get(ids.session, ids.message)).toMatchObject({
      time: { streamed: new Date(streamed.created!) },
    })
    dispose()
  })

  test("parts cannot regress, missing starts are recoverable, and tool metadata/times survive", () => {
    const { value, events, emit, dispose } = setup()
    emit("session.execution.started", { message: assistant() })
    emit("session.reasoning.ended", { partID: "same", text: "final thought" })
    emit("session.reasoning.delta", { partID: "same", text: "late" })
    emit("session.reasoning.started", { partID: "same", ordinal: 0 })
    const called = emit("session.tool.called", { callID: "same", name: "read", input: {}, providerExecuted: false })
    emit("session.tool.input.delta", { callID: "same", text: "late input" })
    emit("session.tool.progress", { callID: "same", metadata: { progress: 0 } })
    const success = emit("session.tool.success", {
      callID: "same",
      name: "read",
      input: {},
      content: [],
      result: false,
      metadata: { count: 0 },
      providerExecuted: false,
      providerMetadata: { cached: false },
    })
    emit("session.tool.called", { callID: "same", name: "read", input: { stale: true } })
    emit("session.text.started", { partID: "same", ordinal: 0 })
    const delta = emit("session.text.delta", { partID: "same", text: "once" })
    events.emit(delta)
    expect(value.session.message.get(ids.session, ids.message)).toMatchObject({
      content: [
        { type: "text", id: "same", text: "once" },
        {
          type: "reasoning",
          id: "same",
          text: "final thought",
          time: { created: expect.any(Date), completed: expect.any(Date) },
        },
        {
          type: "tool",
          id: "same",
          state: { status: "completed", result: false, metadata: { count: 0 } },
          providerExecuted: false,
          providerMetadata: { cached: false },
          time: {
            created: new Date(called.created!),
            ran: new Date(called.created!),
            completed: new Date(success.created!),
          },
        },
      ],
    })
    dispose()
  })

  test("adds known-start usage once per step, and terminal snapshot overrides every provisional field", () => {
    const { value, events, emit, dispose } = setup()
    emit("session.execution.started", { message: assistant() })
    const usage = { cost: 2, tokens: { input: 3, output: 4, reasoning: 5, total: 12, cache: { read: 1, write: 2 } } }
    const step = emit("session.step.ended", { index: 0, finish: "tool-calls", usage })
    events.emit(step)
    emit("session.step.ended", { index: 0, finish: "tool-calls", usage })
    emit("session.step.ended", { index: 1, finish: "stop", usage: { ...usage, costComplete: false } })
    expect(value.session.message.get(ids.session, ids.message)).toMatchObject({
      usage: {
        cost: 4,
        costComplete: false,
        tokens: { total: 24, input: 6, output: 8, reasoning: 10, cache: { read: 2, write: 4 } },
      },
    })
    const final = {
      ...assistant(),
      content: [{ type: "text", id: "text", text: "authoritative" }],
      usage: { ...detail().usage, cost: 99 },
      time: { created: session().createdAt, completed: session().createdAt },
    }
    emit("session.execution.failed", {
      message: final,
      error: { _tag: "SessionError.InternalError", message: "failed" },
    })
    emit("session.text.delta", { partID: "text", text: "late" })
    emit("session.execution.started", { message: assistant() })
    expect(value.session.message.get(ids.session, ids.message)).toMatchObject({
      content: [{ text: "authoritative" }],
      usage: { cost: 99 },
      time: { completed: expect.any(Date) },
    })
    dispose()
  })

  test("snapshot usage has no event watermark: unknown steps do not double count it", async () => {
    const { value, transport, emit, dispose } = setup()
    transport.when(
      (r) => r.url.pathname.endsWith("/message"),
      json({
        data: [
          {
            ...assistant(),
            usage: { ...detail().usage, cost: 7 },
            retry: {
              attempt: 1,
              at: session().createdAt,
              error: { _tag: "SessionError.InternalError", message: "retry" },
            },
          },
        ],
        cursor: {},
      }),
    )
    await value.session.message.sync(ids.session)
    emit("session.execution.started", { message: assistant() })
    emit("session.step.ended", { index: 1, finish: "stop", usage: { ...detail().usage, cost: 7 } })
    expect(value.session.message.get(ids.session, ids.message)).toMatchObject({
      usage: { cost: 7 },
      retry: { at: expect.any(Date) },
    })
    dispose()
  })

  test("compaction accumulates chunks only while running and ignores duplicate occurrences", () => {
    const { value, events, emit, dispose } = setup()
    const compact = { ...message(), type: "compaction", reason: "manual", status: "running", summary: "", recent: "" }
    emit("session.compaction.started", { message: compact })
    emit("session.compaction.delta", { text: "first " })
    const second = emit("session.compaction.delta", { text: "second" })
    events.emit(second)
    expect(value.session.message.get(ids.session, ids.message)).toMatchObject({ summary: "first second" })
    emit("session.compaction.ended", {
      message: { ...compact, status: "completed", summary: "server final" },
      usage: detail().usage,
    })
    emit("session.compaction.delta", { text: "late" })
    expect(value.session.message.get(ids.session, ids.message)).toMatchObject({ summary: "server final" })
    dispose()
  })
})
