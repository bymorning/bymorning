import {
  ByMorning,
  ClientError,
  type ByMorningClient,
  type SessionEventPayload,
  type SessionInfo,
  type WorkspaceEventItem,
} from "@bymorning/client"
import { createData, type EventSource } from "@bymorning/client/solid"
import { Agent } from "@bymorning/schema/agent"
import { Event } from "@bymorning/schema/event"
import { Project } from "@bymorning/schema/project"
import { Provider } from "@bymorning/schema/provider"
import { Permission } from "@bymorning/schema/permission"
import { waitFor } from "@solidjs/testing-library"
import { Session } from "@bymorning/schema/session"
import * as Workspace from "@bymorning/schema/workspace"
import { createRoot } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { createSessionData } from "./session"

const workspace = Workspace.ID.create()
const row = (title: string): SessionInfo => ({
  id: Session.ID.make(crypto.randomUUID()),
  projectID: Project.ID.create(),
  title,
  agent: Agent.DefaultID,
  model: { provider: Provider.Name.make("test"), id: "model" },
  createdAt: new Date(0),
  updatedAt: new Date(1),
})
function fixture(client: ByMorningClient) {
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
  return createRoot((dispose) => {
    const shared = createData({ api: () => client, workspace, event: events })
    const presentation = createSessionData({
      client,
      workspace,
      resource: { signal: new AbortController().signal },
      shared,
    })
    return {
      shared,
      presentation,
      dispose,
      send: (event: WorkspaceEventItem) => listeners.forEach((listener) => listener(event)),
    }
  })
}
describe("shared Session presentation", () => {
  it("retains offscreen attention across shared eviction and reconciles multiple pending requests", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const sessionID = row("Offscreen").id
    const first = { id: Permission.ID.create(), sessionID, action: "read", resources: ["one"] }
    const second = { ...first, id: Permission.ID.create(), resources: ["two"] }
    const list = vi.fn<ByMorningClient["permission"]["request"]["list"]>().mockResolvedValue([first, second])
    const current = fixture({
      ...base,
      permission: { ...base.permission, request: { ...base.permission.request, list } },
    })
    try {
      await current.presentation.syncAttention()
      current.shared.session.evict(sessionID)
      expect(current.presentation.attention(sessionID)).toBe(true)
      list.mockResolvedValueOnce([second])
      const reply: SessionEventPayload = {
        id: Event.ID.make(crypto.randomUUID()),
        type: "permission.v2.replied",
        created: 10,
        data: { sessionID, requestID: first.id, reply: "once" },
      }
      current.presentation.applyWorkspaceEvent(reply, { open: false, foreground: false })
      await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
      expect(current.presentation.attention(sessionID)).toBe(true)
      list.mockResolvedValue([])
      await current.presentation.syncAttention()
      expect(current.presentation.attention(sessionID)).toBe(false)
      expect(current.shared.session.get(sessionID)).toBeUndefined()
    } finally {
      current.dispose()
    }
  })
  it("coalesces a burst of permission events into one in-flight read and one trailing read", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const sessionID = row("Busy").id
    const request = { id: Permission.ID.create(), sessionID, action: "read", resources: ["one"] }
    const gate = Promise.withResolvers<void>()
    const list = vi.fn<ByMorningClient["permission"]["request"]["list"]>().mockImplementation(async () => {
      if (list.mock.calls.length === 1) await gate.promise
      return list.mock.calls.length === 1 ? [request] : []
    })
    const current = fixture({
      ...base,
      permission: { ...base.permission, request: { ...base.permission.request, list } },
    })
    try {
      const asked = (index: number): SessionEventPayload => ({
        id: Event.ID.make(crypto.randomUUID()),
        type: "permission.v2.asked",
        created: index,
        data: { ...request, id: Permission.ID.create() },
      })
      const replied = (index: number): SessionEventPayload => ({
        id: Event.ID.make(crypto.randomUUID()),
        type: "permission.v2.replied",
        created: index,
        data: { sessionID, requestID: request.id, reply: "once" },
      })
      current.presentation.applyWorkspaceEvent(asked(1), { open: false, foreground: false })
      expect(current.presentation.attention(sessionID)).toBe(true)
      for (let index = 2; index < 12; index++)
        current.presentation.applyWorkspaceEvent(index % 2 ? asked(index) : replied(index), {
          open: false,
          foreground: false,
        })
      expect(list).toHaveBeenCalledTimes(1)
      expect(list.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
      gate.resolve()
      await waitFor(() => expect(current.presentation.attention(sessionID)).toBe(false))
      expect(list).toHaveBeenCalledTimes(2)
      expect(current.presentation.attentionRevision(sessionID)).toBe(11)
    } finally {
      current.dispose()
    }
  })
  it("projects root pages and active state directly from shared Data, with unread as independent presentation", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const first = row("First")
    const second = row("Second")
    const list = vi
      .fn<ByMorningClient["session"]["list"]>()
      .mockResolvedValueOnce({ data: [first], cursor: "next" })
      .mockResolvedValueOnce({ data: [second] })
    const { shared, presentation, dispose, send } = fixture({
      ...base,
      session: { ...base.session, list, active: vi.fn().mockResolvedValue({ [first.id]: "running" }) },
    })
    try {
      await shared.session.sync()
      await shared.session.load()
      await shared.session.active.sync()
      expect(new Set(presentation.list().map((item) => item.id))).toEqual(new Set([first.id, second.id]))
      expect(list.mock.calls[0]![0]).toMatchObject({ workspace, parentID: null, archived: false })
      expect(list.mock.calls[1]![0]).toMatchObject({ cursor: "next" })
      expect(presentation.status(first.id)).toBe("running")
      const terminal: SessionEventPayload = {
        id: Event.ID.make(crypto.randomUUID()),
        type: "session.run.succeeded",
        created: 10,
        data: { sessionID: first.id },
      }
      presentation.applyWorkspaceEvent(terminal, { open: true, foreground: false })
      expect(presentation.unread(first.id)).toBe(true)
      expect(presentation.status(first.id)).toBe("running")
      send(terminal)
      expect(presentation.status(first.id)).toBe("idle")
      presentation.view(first.id)
      expect(presentation.unread(first.id)).toBe(false)
    } finally {
      dispose()
    }
  })
  it("moves a Session up the list when live activity Events arrive for it", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const older = row("Older")
    const newer = { ...row("Newer"), updatedAt: new Date(5_000) }
    const list = vi.fn<ByMorningClient["session"]["list"]>().mockResolvedValue({ data: [newer, older] })
    const { shared, presentation, dispose } = fixture({ ...base, session: { ...base.session, list } })
    try {
      await shared.session.sync()
      expect(presentation.list().map((item) => item.id)).toEqual([newer.id, older.id])
      presentation.applyWorkspaceEvent(
        {
          id: Event.ID.make(crypto.randomUUID()),
          type: "session.run.started",
          created: 9_000,
          data: { sessionID: older.id },
        } as SessionEventPayload,
        { open: false, foreground: false },
      )
      expect(presentation.list().map((item) => item.id)).toEqual([older.id, newer.id])
      expect(presentation.list()[0]?.updatedAt.valueOf()).toBe(9_000)
    } finally {
      dispose()
    }
  })
  it("drops a live activity override once the server row catches up", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const older = row("Older")
    const newer = { ...row("Newer"), updatedAt: new Date(5_000) }
    const list = vi.fn<ByMorningClient["session"]["list"]>().mockResolvedValue({ data: [newer, older] })
    const { shared, presentation, dispose, send } = fixture({ ...base, session: { ...base.session, list } })
    try {
      await shared.session.sync()
      presentation.applyWorkspaceEvent(
        {
          id: Event.ID.make(crypto.randomUUID()),
          type: "session.run.started",
          created: 9_000,
          data: { sessionID: older.id },
        } as SessionEventPayload,
        { open: false, foreground: false },
      )
      expect(presentation.list()[0]?.updatedAt.valueOf()).toBe(9_000)
      const caught = { ...older, updatedAt: new Date(9_500) }
      send({
        id: Event.ID.make(crypto.randomUUID()),
        type: "session.updated",
        created: 9_500,
        data: { sessionID: older.id, session: caught },
      } as unknown as WorkspaceEventItem)
      expect(presentation.list()[0]?.updatedAt.valueOf()).toBe(9_500)
      // Were the override still held, a server row older than it would win again.
      send({
        id: Event.ID.make(crypto.randomUUID()),
        type: "session.updated",
        created: 9_600,
        data: { sessionID: older.id, session: { ...older, updatedAt: new Date(8_000) } },
      } as unknown as WorkspaceEventItem)
      expect(presentation.list()[0]?.updatedAt.valueOf()).toBe(8_000)
    } finally {
      dispose()
    }
  })
  it("shares detail reads with other consumers and propagates the original SDK failure", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const info = row("Detail")
    const detail = {
      ...info,
      usage: {
        cost: 0,
        costComplete: true,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    }
    const get = vi.fn<ByMorningClient["session"]["get"]>().mockResolvedValue(detail)
    const current = fixture({ ...base, session: { ...base.session, get } })
    try {
      await current.shared.session.detail.sync(info.id)
      expect(get).toHaveBeenCalledOnce()
      expect(current.presentation.detail(info.id)).toBe(current.shared.session.get(info.id))
      const failure = new ClientError("Transport", { cause: new Error("original SDK failure") })
      get.mockRejectedValueOnce(failure)
      current.shared.session.detail.invalidate(info.id)
      await expect(current.shared.session.detail.sync(info.id)).rejects.toBe(failure)
      expect(current.presentation.detail(info.id)?.title).toBe("Detail")
    } finally {
      current.dispose()
    }
  })
})
