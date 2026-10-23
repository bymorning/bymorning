import { Agent } from "@bymorning/schema/agent"
import { ID } from "@bymorning/schema/message"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import { SessionEvent } from "@bymorning/schema/session-event"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import type { SessionPolicyNotice, TranscriptEntry, TranscriptMessage } from "../../context/session-state"
import { parseTimeline } from "./session-presenter"
import type { SessionUI } from "./ui/session-model"

const sessionID = Schema.decodeUnknownSync(Session.ID)("00000000-0000-4000-8000-000000000001")
const userID = Schema.decodeUnknownSync(ID)("00000000-0000-4000-8000-000000000002")
const assistantID = Schema.decodeUnknownSync(ID)("00000000-0000-4000-8000-000000000003")
const date = new Date("2026-01-01T00:00:00.000Z")
const models = [{ id: "model", name: "Model", provider: Provider.Name.make("bymorning") }]
const entry = (message: TranscriptMessage, activity?: TranscriptEntry["activity"]): TranscriptEntry => ({
  message,
  ...(activity === undefined ? {} : { activity }),
  parts: {},
  origin: "server",
  revision: 1,
})
const user = entry({
  id: userID,
  sessionID,
  sequence: 1,
  admittedSequence: 1,
  createdAt: date,
  type: "user",
  text: "Go",
})
const assistant = (content: Extract<TranscriptMessage, { type: "assistant" }>["content"], completed = false) =>
  entry({
    id: assistantID,
    sessionID,
    sequence: 2,
    createdAt: date,
    type: "assistant",
    agent: Agent.DefaultID,
    model: { id: "model", provider: Provider.Name.make("bymorning") },
    content,
    time: { created: date, ...(completed ? { completed: date } : {}) },
  })
const parse = (data: ReadonlyArray<TranscriptEntry>, previousRows?: ReadonlyArray<SessionUI.TimelineRow>) =>
  parseTimeline({
    transcript: { state: "ready", data, loadingOlder: false },
    models,
    ...(previousRows === undefined ? {} : { previousRows }),
  })
const ready = (value: ReturnType<typeof parseTimeline>) => {
  if (value.state !== "ready") throw new Error("Expected ready timeline")
  return value
}
const policyNotice = (
  effect: SessionPolicyNotice["effect"],
  values: Partial<SessionPolicyNotice> = {},
): SessionPolicyNotice => ({
  id: Schema.decodeUnknownSync(SessionEvent.ID)(crypto.randomUUID()),
  created: "2026-01-01T00:00:01.000Z",
  sessionID,
  policy: "workspace",
  rule: 0,
  action: "shell",
  resource: "command",
  effect,
  ...values,
})

describe("parseTimeline", () => {
  it("presents an assistant retry without replacing its message or content identity", () => {
    const content = [{ type: "text" as const, id: "answer", text: "Partial answer" }]
    const retrying = assistant(content)
    if (retrying.message.type !== "assistant") throw new Error("Expected assistant")
    const model = ready(
      parse([
        user,
        {
          ...retrying,
          message: {
            ...retrying.message,
            retry: {
              attempt: 2,
              at: new Date("2026-01-01T14:03:05.000Z"),
              error: { _tag: "SessionError.ProviderError", message: "Temporarily unavailable" },
            },
          },
        },
      ]),
    )

    expect(model.items).toHaveLength(1)
    expect(model.items[0]).toMatchObject({
      type: "turn",
      assistant: [{ id: assistantID, retry: { attempt: 2, at: Date.parse("2026-01-01T14:03:05.000Z") } }],
    })
    expect(model.partByKey.get(`${assistantID}:answer`)?.part).toMatchObject({ id: "answer", text: "Partial answer" })
  })

  it.each([
    ["route", undefined, "Request routed by policy", "A policy selected a different route for this request."],
    ["deny", "Blocked by workspace policy", "Request denied by policy", "Blocked by workspace policy"],
  ] as const)(
    "projects client-only %s Policy notices with message and fallback text",
    (effect, message, text, detail) => {
      const policyNotices = [policyNotice(effect, message === undefined ? {} : { message })]
      const model = ready(
        parseTimeline({
          transcript: { state: "ready", data: [user], loadingOlder: false },
          policyNotices,
          models,
        }),
      )

      expect(model.items).toMatchObject([{ type: "notice", kind: "policy", effect, text, detail }, { type: "turn" }])
      expect(model.noticeByID.get(policyNotices[0]!.id)).toMatchObject({
        effect,
        text,
        action: "shell",
        resource: "command",
        policy: "workspace",
        rule: 0,
        created: "2026-01-01T00:00:01.000Z",
      })
    },
  )

  it.each([
    ["route", { messageID: userID }, ["user-message", "notice", "assistant-part"]],
    ["deny", { messageID: assistantID }, ["user-message", "assistant-part", "notice"]],
  ] as const)("places associated %s notices beside their owning message or tool turn", (effect, association, rows) => {
    const model = ready(
      parseTimeline({
        transcript: {
          state: "ready",
          data: [
            user,
            assistant([
              {
                type: "tool",
                id: "call",
                name: "lookup",
                state: { status: "running", input: {} },
                time: { created: date },
              },
            ]),
          ],
          loadingOlder: false,
        },
        policyNotices: [policyNotice(effect, association)],
        models,
      }),
    )

    expect(model.rows.map((row) => row.type)).toEqual(rows)
    expect([...model.noticeByID.values()][0]).toMatchObject(association)
  })

  it("uses a leading fallback for unassociated notices and orders each position by envelope time and ID", () => {
    const lateID = Schema.decodeUnknownSync(SessionEvent.ID)("00000000-0000-4000-8000-000000000020")
    const earlyID = Schema.decodeUnknownSync(SessionEvent.ID)("00000000-0000-4000-8000-000000000010")
    const model = ready(
      parseTimeline({
        transcript: { state: "ready", data: [user], loadingOlder: false },
        policyNotices: [
          policyNotice("deny", { id: lateID, created: "2026-01-01T00:00:02.000Z" }),
          policyNotice("route", { id: earlyID, created: "2026-01-01T00:00:01.000Z" }),
        ],
        models,
      }),
    )

    expect(model.items.map((item) => item.id)).toEqual([earlyID, lateID, userID])
    expect(model.rows.map((row) => row.type)).toEqual(["notice", "notice", "user-message"])
  })

  it("maps load states", () => {
    expect(parseTimeline({ transcript: { state: "loading" }, models })).toEqual({ state: "loading" })
    expect(parseTimeline({ transcript: { state: "error", message: "Offline" }, models })).toEqual({
      state: "failed",
      message: "Offline",
    })
  })

  it("projects pending users directly from transcript activity", () => {
    const model = ready(
      parse([
        entry(
          { type: "pending-user", id: userID, sessionID, text: "Queued", agents: [], createdAt: date },
          { state: "queued" },
        ),
      ]),
    )
    expect(model.items).toMatchObject([{ user: { text: "Queued" }, state: { type: "queued" } }])
  })

  it("renders a hydrated partial and subsequent live text and reasoning", () => {
    const model = ready(
      parse([
        user,
        assistant([
          { type: "text", id: "text", text: "persisted prefix suffix" },
          { type: "reasoning", id: "reason", text: "thinking live" },
        ]),
      ]),
    )
    expect(model.items).toMatchObject([
      {
        state: { type: "working" },
        assistant: [
          {
            streaming: true,
            parts: [
              { type: "text", text: "persisted prefix suffix" },
              { type: "reasoning", text: "thinking live" },
            ],
          },
        ],
      },
    ])
  })

  it("keeps text and reasoning row keys through authoritative durable repair", () => {
    const partial = ready(
      parse([
        user,
        assistant([
          { type: "text", id: "text", text: " suffix" },
          { type: "reasoning", id: "reason", text: "thin" },
        ]),
      ]),
    )
    const repaired = ready(
      parse(
        [
          user,
          assistant(
            [
              { type: "text", id: "text", text: "prefix restored suffix" },
              { type: "reasoning", id: "reason", text: "thinking complete" },
            ],
            true,
          ),
        ],
        partial.rows,
      ),
    )
    for (const id of ["text", "reason"])
      expect(repaired.rowByKey.has(`assistant-part:part:${assistantID}:${id}`)).toBe(true)
    expect(repaired.partByKey.get(`${assistantID}:text`)?.part).toMatchObject({ text: "prefix restored suffix" })
  })

  it("keeps lifecycle streaming but disables part pacing while cancelling", () => {
    const cancelling = assistant([{ type: "text", id: "text", text: "Partial" }])
    const model = ready(parse([user, { ...cancelling, activity: { state: "cancelling" } }]))
    expect(model.items).toMatchObject([{ assistant: [{ streaming: true, cancelling: true }] }])
    expect(model.partByKey.get(`${assistantID}:text`)?.streaming).toBe(false)
  })

  it("derives completed and failed turn state from assistant markers", () => {
    const complete = ready(parse([user, assistant([{ type: "text", id: "text", text: "Done" }], true)]))
    expect(complete.items).toMatchObject([{ state: { type: "complete" } }])
  })

  it.each([undefined, "Instructions updated: core/date, core/codemode"])(
    "hides model instruction updates with description %s",
    (description) => {
      const update = entry({
        id: Schema.decodeUnknownSync(ID)("00000000-0000-4000-8000-000000000004"),
        sessionID,
        sequence: 2,
        createdAt: date,
        type: "system",
        text: "Today's date is now: Wed Sep 09 2026\n\nThe Code Mode tool catalog below is complete.",
        ...(description === undefined ? {} : { description }),
      })
      const reply = assistant([{ type: "text", id: "text", text: "Done" }], true)
      expect(ready(parse([user, update, reply])).items).toEqual(ready(parse([user, reply])).items)
    },
  )

  it.each([
    [
      "synthetic",
      {
        id: userID,
        sessionID,
        sequence: 2,
        createdAt: date,
        type: "synthetic",
        text: "private",
        description: "Background completed",
      },
      { kind: "system", text: "Background completed" },
    ],
    [
      "agent selection",
      { id: userID, sessionID, sequence: 2, createdAt: date, type: "agent-switched", agent: Agent.DefaultID },
      { kind: "selection", text: "Agent switched to default" },
    ],
    [
      "model selection",
      {
        id: userID,
        sessionID,
        sequence: 2,
        createdAt: date,
        type: "model-switched",
        model: { id: "model", provider: Provider.Name.make("bymorning") },
      },
      { kind: "selection", text: "Model switched to Model" },
    ],
    [
      "unlisted model selection",
      {
        id: userID,
        sessionID,
        sequence: 2,
        createdAt: date,
        type: "model-switched",
        model: { id: "retired", provider: Provider.Name.make("bymorning"), variant: "high" },
      },
      { kind: "selection", text: "Model switched to retired · high" },
    ],
    [
      "compaction",
      {
        id: userID,
        sessionID,
        sequence: 2,
        createdAt: date,
        type: "compaction",
        status: "completed",
        reason: "auto",
        summary: "summary",
        recent: "recent",
      },
      {
        kind: "compaction",
        status: "completed",
        reason: "auto",
        text: "Session compacted",
        detail: "Future messages will use this checkpoint.",
        summary: "summary",
        recent: "recent",
      },
    ],
  ] as const)("projects %s notices from transcript messages", (_name, message, expected) => {
    expect(ready(parse([entry(message)])).items).toMatchObject([expected])
  })

  it("presents queued and failed compactions as truthful lifecycle states", () => {
    const queued = entry({
      id: userID,
      sessionID,
      type: "pending-compaction" as const,
      admittedSequence: 2,
      createdAt: date,
    })
    const failed = entry({
      id: Schema.decodeUnknownSync(ID)("00000000-0000-4000-8000-000000000004"),
      sessionID,
      sequence: 3,
      createdAt: date,
      type: "compaction" as const,
      status: "failed" as const,
      reason: "manual" as const,
      error: { _tag: "SessionError.InternalError" as const, message: "Nothing to compact yet" },
    })

    expect(ready(parse([queued, failed])).items).toMatchObject([
      {
        kind: "compaction",
        status: "queued",
        reason: "manual",
        text: "Compaction queued",
        detail: "Waiting for current work to finish.",
      },
      {
        kind: "compaction",
        status: "failed",
        reason: "manual",
        text: "Compaction failed",
        detail: "Nothing to compact yet",
      },
    ])
  })

  it.each([
    ["running", { state: "running" }, { type: "working" }],
    ["failed", { state: "failed", message: "Nope" }, { type: "failed", failure: { type: "generic", message: "Nope" } }],
    ["cancelled", { state: "cancelled" }, { type: "interrupted" }],
  ] as const)("projects %s pending activity", (_name, activity, expected) => {
    const pending = entry(
      { type: "pending-user", id: userID, sessionID, text: "Pending", agents: [], createdAt: date },
      activity,
    )
    expect(ready(parse([pending])).items).toMatchObject([{ state: expected }])
  })

  it.each([
    ["streaming", { status: "streaming", input: "{" }, { type: "running" }],
    ["running", { status: "running", input: { path: "a.ts" } }, { type: "running" }],
    [
      "completed",
      {
        status: "completed",
        input: {},
        content: [{ type: "text" as const, text: "Done" }] as Array<{ type: "text"; text: string }>,
        result: "Done",
      },
      { type: "succeeded" },
    ],
    [
      "failed",
      { status: "error", input: {}, error: { _tag: "SessionError.ToolError", message: "Nope" } },
      { type: "failed", message: "Nope" },
    ],
    [
      "interrupted",
      { status: "error", input: {}, error: { _tag: "SessionError.AbortedError", message: "Stopped" } },
      { type: "interrupted" },
    ],
  ] as const)("projects %s durable tool state", (_name, state, expected) => {
    const model = ready(
      parse([
        user,
        assistant([{ type: "tool", id: "call", name: "lookup", state, time: { created: date, completed: date } }]),
      ]),
    )
    expect(model.items).toMatchObject([{ assistant: [{ parts: [{ state: expected }] }] }])
  })

  it.each([
    ["failed", { _tag: "SessionError.ProviderError", message: "Provider failed" }, { type: "failed" }],
    ["interrupted", { _tag: "SessionError.AbortedError", message: "Stopped" }, { type: "interrupted" }],
  ] as const)("projects %s durable assistant errors", (_name, error, expected) => {
    const value = assistant([{ type: "text", id: "text", text: "Partial" }], true)
    const failed = { ...value, message: { ...value.message, error } }
    expect(ready(parse([user, failed])).items).toMatchObject([{ state: expected }])
  })

  it.each([
    ["exact policy failure", "SessionError.ProviderError", "Model request denied by policy", "policy", "Model"],
    [
      "same literal with another tag",
      "SessionError.InternalError",
      "Model request denied by policy",
      "generic",
      undefined,
    ],
    ["other provider failure", "SessionError.ProviderError", "Provider failed", "generic", undefined],
  ] as const)("strictly classifies %s", (_name, tag, message, type, modelName) => {
    const value = assistant([], true)
    const error = { _tag: tag, message } as NonNullable<Extract<TranscriptMessage, { type: "assistant" }>["error"]>
    const failed = { ...value, message: { ...value.message, error } }
    const timeline = ready(parse([user, failed]))
    const row = timeline.rows.find((candidate) => candidate.type === "error")

    expect(timeline.items).toMatchObject([{ state: { type: "failed", failure: { type } } }])
    expect(row).toMatchObject({ type: "error", failure: { type } })
    if (modelName) expect(row).toMatchObject({ failure: { model: modelName, agent: "Default" } })
  })

  it("presents structured provider failure details", () => {
    const value = assistant([], true)
    const failed = {
      ...value,
      message: {
        ...value.message,
        error: {
          _tag: "SessionError.ProviderError",
          message: "Fireworks: authentication failed (401): Invalid API key",
          category: "auth",
          status: 401,
          provider: "fireworks",
          model: "accounts/fireworks/models/test",
          requestID: "req_123",
          responseBody: '{"error":{"message":"Invalid API key"}}',
          bodyTruncated: false,
        } as const,
      },
    }
    expect(ready(parse([user, failed])).rows.find((row) => row.type === "error")).toMatchObject({
      failure: {
        type: "provider",
        summary: "Fireworks: authentication failed (401)",
        message: "Invalid API key",
        requestID: "req_123",
        responseBody: '{"error":{"message":"Invalid API key"}}',
        bodyTruncated: false,
      },
    })
  })

  it("presents a Budget refusal as a generic budget message instead of a Provider quota failure", () => {
    const value = assistant([], true)
    const failed = {
      ...value,
      message: {
        ...value.message,
        error: {
          _tag: "SessionError.ProviderError",
          message: "Provider: quota exceeded: Workspace budget reached: the spend limit has no room left this period.",
          category: "quota",
        } as const,
      },
    }
    expect(ready(parse([user, failed])).rows.find((row) => row.type === "error")).toMatchObject({
      failure: {
        type: "generic",
        message: "Workspace budget reached: the spend limit has no room left this period.",
      },
    })
  })

  it("omits the model when no friendly model option exists", () => {
    const value = assistant([], true)
    const failed = {
      ...value,
      message: {
        ...value.message,
        model: { id: "unknown-model", provider: Provider.Name.make("bymorning") },
        error: { _tag: "SessionError.ProviderError", message: "Model request denied by policy" } as const,
      },
    }
    const timeline = ready(parse([user, failed]))
    expect(timeline.rows.find((row) => row.type === "error")).toMatchObject({
      failure: { type: "policy" },
    })
    expect(timeline.rows.find((row) => row.type === "error")).not.toHaveProperty("failure.model")
  })

  it.each([
    [
      "model deny",
      "deny",
      "model.request",
      "bymorning/model",
      "Model request denied by policy",
      "Model cannot handle this request in this session.",
    ],
    [
      "direct tool deny",
      "deny",
      "tool.execute",
      "shell",
      "Tool denied by policy",
      "Shell cannot be used in this session.",
    ],
    [
      "model and tool",
      "deny",
      "model.tool",
      "bymorning/model::shell",
      "Model tool denied by policy",
      "Shell cannot be used with Model in this session.",
    ],
    [
      "tool combination",
      "deny",
      "tool.combine",
      "shell::file_read",
      "Tool combination denied by policy",
      "Shell and File read cannot be combined in this session.",
    ],
    [
      "route",
      "route",
      "model.request",
      "bymorning/model",
      "Model request routed by policy",
      "A policy selected a different route for this request.",
    ],
  ] as const)("presents concise %s notice copy", (_name, effect, action, resource, text, detail) => {
    const timeline = ready(
      parseTimeline({
        transcript: { state: "ready", data: [user], loadingOlder: false },
        policyNotices: [policyNotice(effect, { action, resource })],
        models,
      }),
    )
    expect(timeline.items[0]).toMatchObject({ text, detail })
  })

  it("uses a non-empty authored Policy message as notice detail", () => {
    const timeline = ready(
      parseTimeline({
        transcript: { state: "ready", data: [user], loadingOlder: false },
        policyNotices: [
          policyNotice("deny", { action: "tool.execute", resource: "shell", message: "Not on production" }),
        ],
        models,
      }),
    )
    expect(timeline.items[0]).toMatchObject({ text: "Tool denied by policy", detail: "Not on production" })
  })
})
