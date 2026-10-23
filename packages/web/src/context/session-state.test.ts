import { ByMorning, type WorkspaceEventItem } from "@bymorning/client"
import { createData, type EventSource, type Message } from "@bymorning/client/solid"
import { Agent } from "@bymorning/schema/agent"
import { ID as MessageID } from "@bymorning/schema/message"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import { ID as EventID } from "@bymorning/schema/session-event"
import { Workspace } from "@bymorning/schema/workspace"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { describe, expect, it } from "vitest"

import { createController } from "../features/session/timeline-controller"
import { parseTimeline } from "../features/session/session-presenter"
import { createSessionProjection, type SessionReadiness } from "./session-state"

const sessionID = Session.ID.make("00000000-0000-4000-8000-000000000001")
const id = (n: number) => MessageID.make(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`)
const model = { provider: Provider.Bymorning, id: "model" }
const usage = {
  cost: 0,
  costComplete: true,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
}
const user = (n = 1): Message => ({
  id: id(n),
  sessionID,
  sequence: n,
  admittedSequence: n,
  createdAt: new Date(n),
  type: "user",
  text: "hello",
})
const assistant = (): Message => ({
  id: id(2),
  sessionID,
  sequence: 2,
  createdAt: new Date(2),
  type: "assistant",
  agent: Agent.DefaultID,
  model,
  content: [{ type: "text", id: "text", text: "" }],
  time: { created: new Date(2) },
  usage,
})
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

/** A pure adapter test using the real Data and generated SDK at a controlled HTTP boundary. */
function setup(initial: Message[] = [user(), assistant()]) {
  const listeners = new Set<(event: WorkspaceEventItem) => void>()
  const events: EventSource = {
    listen: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    on: (type, listener) =>
      events.listen((event) => {
        if (event.type === type) listener(event as Extract<WorkspaceEventItem, { type: typeof type }>)
      }),
  }
  const requests: URL[] = []
  let page = { data: initial, cursor: {} as { next?: string } }
  let inbox: unknown[] = []
  let respond: ((url: URL) => Response | Promise<Response> | undefined) | undefined
  const api = ByMorning.make({
    baseUrl: "http://projection.test",
    fetch: async (input) => {
      const url = new URL(input.toString())
      requests.push(url)
      const response = respond?.(url)
      if (response !== undefined) return response
      if (url.pathname.endsWith("/message")) return json(page)
      if (url.pathname.endsWith("/inbox")) return json({ data: inbox })
      throw new Error(`Unexpected request ${url.pathname}`)
    },
  })
  return createRoot((dispose) => {
    const shared = createData({ api: () => api, workspace: Workspace.ID.make("wrk_projection"), event: events })
    const [state, setState] = createStore<{ readiness: SessionReadiness }>({ readiness: { state: "loading" } })
    const projection = createSessionProjection(shared, sessionID, () => state.readiness)
    const controller = createController({
      data: { ...projection, models: () => [], policyNotices: () => [] },
      history: projection,
    })
    return {
      shared,
      projection,
      controller,
      requests,
      dispose,
      ready: () => setState("readiness", { state: "ready" }),
      emit: (event: WorkspaceEventItem) => {
        for (const listener of listeners) listener(event)
      },
      page: (data: Message[], next?: string) => {
        page = { data, cursor: next === undefined ? {} : { next } }
      },
      inbox: (rows: unknown[]) => {
        inbox = rows
      },
      respond: (handler: typeof respond) => {
        respond = handler
      },
    }
  })
}

describe("shared Session presentation", () => {
  it("does not bootstrap reads and follows web-owned readiness", async () => {
    const test = setup([])
    try {
      expect(test.requests).toHaveLength(0)
      expect(test.projection.transcript()).toEqual({ state: "loading" })
      await test.shared.session.message.sync(sessionID)
      test.ready()
      expect(test.projection.transcript()).toMatchObject({ state: "ready", data: [] })
      expect(test.controller.model().state).toBe("ready")
    } finally {
      test.dispose()
    }
  })

  it("revises only the streaming entry and preserves transcript and topology during visible token updates", async () => {
    const test = setup()
    try {
      await test.shared.session.message.sync(sessionID)
      test.ready()
      const before = test.projection.transcript()
      const stable = test.projection.entry(id(1))!
      const streaming = test.projection.entry(id(2))!
      const stableRevision = stable.revision
      const initialTopology = test.projection.topology()
      const delta = (text: string) =>
        test.emit({
          id: EventID.make(crypto.randomUUID()),
          created: 3,
          type: "session.text.delta",
          data: { sessionID, messageID: id(2), partID: "text", text },
        })
      delta("hello")
      expect(test.projection.topology()).toBeGreaterThan(initialTopology)
      const visibleTopology = test.projection.topology()
      const timeline = test.controller.model()
      const revision = streaming.revision
      delta(" world")
      expect(streaming.revision).toBeGreaterThan(revision)
      expect(stable.revision).toBe(stableRevision)
      expect(test.projection.transcript()).toBe(before)
      expect(test.projection.entry(id(1))).toBe(stable)
      expect(test.projection.topology()).toBe(visibleTopology)
      expect(test.controller.model()).toBe(timeline)
      expect(streaming.message).toBe(test.shared.session.message.get(sessionID, id(2)))
      expect(timeline.state === "ready" && timeline.resolvePart?.(id(2), "text")?.part).toMatchObject({
        text: "hello world",
      })
    } finally {
      test.dispose()
    }
  })

  it("projects canonical retry, tools, completion, and usage after reconciliation", async () => {
    const test = setup()
    try {
      await test.shared.session.message.sync(sessionID)
      test.ready()
      const row = assistant()
      if (row.type !== "assistant") throw new Error("assistant expected")
      test.page([
        user(),
        {
          ...row,
          retry: { attempt: 2, at: new Date(200), error: { _tag: "SessionError.ProviderError", message: "retry" } },
          content: [
            { type: "reasoning", id: "reason", text: "thinking" },
            {
              type: "tool",
              id: "tool",
              name: "lookup",
              state: { status: "running", input: { query: "search" } },
              time: { created: new Date(3) },
            },
          ],
        },
      ])
      test.shared.session.message.invalidate(sessionID)
      await test.shared.session.message.sync(sessionID)
      expect(test.projection.entry(id(2))?.parts["tool:tool"]?.phase).toBe("running")
      expect(test.projection.entry(id(2))?.parts["reasoning:reason"]?.sequence).toBeLessThan(
        test.projection.entry(id(2))!.parts["tool:tool"]!.sequence,
      )
      const retry = test.controller.model()
      expect(retry.state === "ready" && retry.items.at(-1)).toMatchObject({
        assistant: [{ retry: { attempt: 2, at: 200 } }],
      })
      test.page([
        user(),
        {
          ...row,
          finish: "stop",
          time: { created: new Date(2), completed: new Date(100) },
          usage: { ...usage, cost: 0.5 },
        },
      ])
      test.shared.session.message.invalidate(sessionID)
      await test.shared.session.message.sync(sessionID)
      const completed = test.controller.model()
      expect(completed.state === "ready" && completed.items.at(-1)).toMatchObject({
        state: { type: "complete" },
        assistant: [{ details: { usage: { cost: 0.5 }, durationMs: 98 } }],
      })
    } finally {
      test.dispose()
    }
  })

  it("keeps admitted input after durable history and exposes uncertain submission failures", async () => {
    const test = setup([user()])
    try {
      test.inbox([
        {
          id: id(3),
          sessionID,
          admittedSequence: 1,
          createdAt: new Date(3),
          type: "user",
          payload: { text: "queued" },
          delivery: "steer",
        },
      ])
      await Promise.all([test.shared.session.message.sync(sessionID), test.shared.session.inbox.sync(sessionID)])
      test.ready()
      const read = () => {
        const value = test.projection.transcript()
        return value.state === "ready" ? value.data : []
      }
      expect(read().map((entry) => entry.message.id)).toEqual([id(1), id(3)])
      expect(test.projection.entry(id(3))?.activity).toEqual({ state: "queued" })
      test.respond((url) => {
        if (url.pathname.endsWith("/prompt")) throw new TypeError("Disconnected")
      })
      await expect(test.shared.session.prompt({ sessionID, id: id(4), text: "uncertain" })).rejects.toBeDefined()
      const failed = test.projection.entry(id(4))
      expect(failed?.origin).toBe("local")
      expect(failed?.activity).toMatchObject({ state: "failed", message: expect.stringContaining("uncertain") })
      const timeline = parseTimeline({ transcript: test.projection.transcript(), models: [] })
      expect(timeline.state === "ready" && timeline.items.at(-1)).toMatchObject({ state: { type: "failed" } })
      test.shared.session.submission.dismiss(sessionID, id(4))
      expect(test.projection.entry(id(4))).toBeUndefined()
      // A promoted Message wins even if the Inbox observation has not caught up yet.
      test.page([user(), { ...user(3), sequence: 4 }])
      test.shared.session.message.invalidate(sessionID)
      await test.shared.session.message.sync(sessionID)
      expect(read().map((entry) => entry.message.id)).toEqual([id(1), id(3)])
      expect(test.projection.entry(id(3))?.message.type).toBe("user")
      expect(test.projection.entry(id(3))?.activity).toBeUndefined()
    } finally {
      test.dispose()
    }
  })

  it("delegates older loading, preserves prepend anchors, and detects replacement windows", async () => {
    const test = setup([user(3)])
    try {
      test.page([user(3)], "older")
      await test.shared.session.message.sync(sessionID)
      test.ready()
      const replacement = test.projection.windowReplacement()
      test.respond((url) =>
        url.searchParams.get("cursor") === "older" ? json({ data: [user(1)], cursor: {} }) : undefined,
      )
      await test.projection.loadOlder()
      expect(test.projection.windowReplacement()).toBe(replacement)
      expect(test.projection.transcript()).toMatchObject({
        data: [{ message: { id: id(1) } }, { message: { id: id(3) } }],
        loadingOlder: false,
      })
      test.page([user(4)])
      test.shared.session.evict(sessionID)
      test.shared.session.message.invalidate(sessionID)
      await test.shared.session.message.sync(sessionID)
      expect(test.projection.windowReplacement()).toBeGreaterThan(replacement)
    } finally {
      test.dispose()
    }
  })

  it("presents rejected compactions with the original generated error detail", async () => {
    const test = setup([])
    try {
      test.ready()
      test.respond((url) =>
        url.pathname.endsWith("/compact")
          ? json(
              {
                _tag: "Session.CompactionConflictError",
                sessionID,
                messageID: id(4),
                message: "Compaction already admitted",
              },
              409,
            )
          : undefined,
      )
      await expect(test.shared.session.compact({ sessionID, id: id(4) })).rejects.toMatchObject({
        _tag: "Session.CompactionConflictError",
      })
      expect(test.shared.session.submission.list(sessionID)[0]?.state.state).toBe("failed")
      const timeline = test.controller.model()
      expect(timeline.state === "ready" && timeline.items[0]).toMatchObject({
        kind: "compaction",
        status: "failed",
        text: "Compaction failed",
        detail: "Compaction already admitted",
      })
    } finally {
      test.dispose()
    }
  })

  it("exposes older-page failure without losing the current transcript", async () => {
    const test = setup([user(3)])
    try {
      test.page([user(3)], "older")
      await test.shared.session.message.sync(sessionID)
      test.ready()
      test.respond((url) =>
        url.searchParams.has("cursor")
          ? json({ _tag: "Session.NotFoundError", sessionID, message: "History unavailable" }, 404)
          : undefined,
      )
      await test.projection.loadOlder()
      expect(test.projection.transcript()).toMatchObject({
        state: "ready",
        data: [{ message: { id: id(3) } }],
        olderError: "History unavailable",
        loadingOlder: false,
      })
    } finally {
      test.dispose()
    }
  })
})
