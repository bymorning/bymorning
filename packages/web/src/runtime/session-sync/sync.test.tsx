import { render, waitFor } from "@solidjs/testing-library"
import { afterEach, expect, it, vi } from "vitest"
import type { WorkspaceEventItem } from "@bymorning/client"
import { Event } from "@bymorning/schema/event"
import { Session } from "@bymorning/schema/session"
import * as Workspace from "@bymorning/schema/workspace"
import { createMulticast } from "../workspace-event/channel"
import { SessionSync } from "./sync"
import { sessionRouteHref } from "../../workspace-route-paths"

const context = vi.hoisted(() => ({
  apply: vi.fn(),
  attention: vi.fn<() => Promise<void>>(),
  location: { pathname: "" },
  workspace: "" as string,
  subscribe: vi.fn<(input: { signal: AbortSignal }) => AsyncIterable<WorkspaceEventItem>>(),
}))
vi.mock("@solidjs/router", () => ({ useLocation: () => context.location }))
vi.mock("../../context/data", () => ({
  useData: () => ({ session: { applyWorkspaceEvent: context.apply, syncAttention: context.attention } }),
}))
vi.mock("../../context/workspace", () => ({ useWorkspace: () => ({ current: () => ({ id: context.workspace }) }) }))
vi.mock("../../context/workspace-event", () => ({ useWorkspaceEvent: () => ({ subscribe: context.subscribe }) }))
afterEach(() => vi.clearAllMocks())

it("keeps presentation events live and releases the feed", async () => {
  const feed = createMulticast<WorkspaceEventItem>(16)
  context.attention.mockResolvedValue()
  context.subscribe.mockImplementation(({ signal }) => feed.read(signal))
  const workspace = Workspace.ID.create()
  const sessionID = Session.ID.make(crypto.randomUUID())
  context.workspace = workspace
  context.location.pathname = sessionRouteHref(workspace, sessionID)
  const view = render(() => <SessionSync />)
  feed.send({ id: Event.ID.make(crypto.randomUUID()), type: "server.connected", data: {} })
  const finished: WorkspaceEventItem = {
    id: Event.ID.make(crypto.randomUUID()),
    type: "session.run.succeeded",
    created: 10,
    data: { sessionID },
  }
  feed.send(finished)
  await waitFor(() => expect(context.apply).toHaveBeenCalledWith(finished, { open: true, foreground: true }))
  feed.send({ id: Event.ID.make(crypto.randomUUID()), type: "server.connected", data: {} })
  context.location.pathname = "/elsewhere"
  feed.send(finished)
  await waitFor(() => expect(context.apply).toHaveBeenLastCalledWith(finished, { open: false, foreground: false }))
  const signal = context.subscribe.mock.calls[0]![0].signal
  view.unmount()
  expect(signal.aborted).toBe(true)
  feed.close()
})
