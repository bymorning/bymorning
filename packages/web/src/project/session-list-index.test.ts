import type { SessionInfo } from "@bymorning/client"
import { Agent } from "@bymorning/schema/agent"
import { Project } from "@bymorning/schema/project"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import { describe, expect, it, vi } from "vitest"

import {
  HOME_SESSION_PAGE_LIMIT,
  loadHomeSessionIndex,
  mergeHomeSessionIndex,
  retainHomeSessions,
  SESSION_RECENT_LIMIT,
  SESSION_RECENT_WINDOW,
} from "./session-list-index"

const first = Project.ID.create()
const second = Project.ID.create()

describe("session-list-index", () => {
  it("exhausts pagination and filters child and archived Sessions", async () => {
    const root = session(1, first, 3)
    const list = vi
      .fn()
      .mockResolvedValueOnce({ data: [root, session(2, first, 2, { parentID: root.id })], cursor: "next" })
      .mockResolvedValueOnce({ data: [session(3, first, 1, { archivedAt: new Date() })] })

    await expect(loadHomeSessionIndex(list)).resolves.toEqual([root])
    expect(list).toHaveBeenNthCalledWith(1, { limit: HOME_SESSION_PAGE_LIMIT }, {})
    expect(list).toHaveBeenNthCalledWith(2, { limit: HOME_SESSION_PAGE_LIMIT, cursor: "next" }, {})
  })

  it("lets live-known rows override fetched rows", () => {
    const fetched = session(1, first, 1)
    const known = { ...fetched, title: "Live title", updatedAt: new Date(2) }

    expect(mergeHomeSessionIndex([fetched], [known])).toEqual([known])
  })

  it("retains 64 per Project plus at most 50 recently updated tail rows", () => {
    const now = SESSION_RECENT_WINDOW * 2
    const recent = Array.from({ length: 130 }, (_, index) => session(index + 1, first, now - index))
    const old = Array.from({ length: 70 }, (_, index) => session(index + 201, second, index))
    const retained = retainHomeSessions([...recent, ...old], 64, now)

    expect(retained.filter((item) => item.projectID === first)).toHaveLength(64 + SESSION_RECENT_LIMIT)
    expect(retained.filter((item) => item.projectID === second)).toHaveLength(64)
  })

  it("orders equal timestamps by ascending Session ID", () => {
    const timestamp = 1
    expect(retainHomeSessions([session(2, first, timestamp), session(1, first, timestamp)], 64, timestamp)).toEqual([
      session(1, first, timestamp),
      session(2, first, timestamp),
    ])
  })
})

function session(
  index: number,
  projectID: Project.ID,
  updatedAt: number,
  input: { readonly parentID?: Session.ID; readonly archivedAt?: Date } = {},
): SessionInfo {
  return {
    id: Session.ID.make(
      `${index.toString(16).padStart(8, "0")}-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
    ),
    projectID,
    title: `Session ${index}`,
    agent: Agent.DefaultID,
    model: { id: "model", provider: Provider.Name.make("test") },
    createdAt: new Date(updatedAt),
    updatedAt: new Date(updatedAt),
    ...(input.parentID === undefined ? {} : { parentID: input.parentID }),
    ...(input.archivedAt === undefined ? {} : { archivedAt: input.archivedAt }),
  }
}
