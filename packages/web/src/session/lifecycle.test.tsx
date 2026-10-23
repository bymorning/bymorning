import { ByMorning, type ByMorningClient, type SessionInfo, type SessionNotFoundError } from "@bymorning/client"
import { createData } from "@bymorning/client/solid"
import { Agent } from "@bymorning/schema/agent"
import { Project } from "@bymorning/schema/project"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import * as Workspace from "@bymorning/schema/workspace"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { render, waitFor } from "@solidjs/testing-library"
import { expect, it, vi } from "vitest"
import { createLifecycle } from "./lifecycle"

it("tracks concurrent rows across hook instances, isolates scopes, and never retries a rejected lifecycle mutation", async () => {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  const workspace = Workspace.ID.create()
  const firstID = Session.ID.make(crypto.randomUUID())
  const secondID = Session.ID.make(crypto.randomUUID())
  const first = Promise.withResolvers<SessionInfo>()
  const second = Promise.withResolvers<SessionInfo>()
  const update = vi
    .fn<ByMorningClient["session"]["update"]>()
    .mockImplementation((input) => (input.sessionID === firstID ? first.promise : second.promise))
  const detail = vi.fn<ByMorningClient["session"]["get"]>()
  const client = {
    ...base,
    session: { ...base.session, update, get: detail, list: vi.fn().mockResolvedValue({ data: [] }) },
  }
  const query = new QueryClient({ defaultOptions: { mutations: { retry: 3, retryDelay: 0 } } })
  const key = ["http://localhost", "member", workspace]
  let list!: ReturnType<typeof createLifecycle>
  let screen!: ReturnType<typeof createLifecycle>
  let other!: ReturnType<typeof createLifecycle>
  function Consumer() {
    const shared = createData({
      api: () => client,
      workspace,
      event: { listen: () => () => undefined, on: () => () => undefined },
    })
    list = createLifecycle({ client, shared, key })
    screen = createLifecycle({ client, shared, key })
    other = createLifecycle({ client, shared, key: ["http://localhost", "other-member", workspace] })
    return <div />
  }
  const view = render(() => (
    <QueryClientProvider client={query}>
      <Consumer />
    </QueryClientProvider>
  ))
  try {
    const firstResult = list.update({ sessionID: firstID, archived: true }).catch((cause: unknown) => cause)
    const secondResult = list.update({ sessionID: secondID, archived: true })
    await waitFor(() => {
      expect(screen.pending(firstID)).toBe(true)
      expect(screen.pending(secondID)).toBe(true)
    })
    expect(other.pending(firstID)).toBe(false)
    second.resolve({
      id: secondID,
      projectID: Project.ID.create(),
      title: "Second",
      agent: Agent.DefaultID,
      model: { provider: Provider.Name.make("test"), id: "model" },
      createdAt: new Date(0),
      updatedAt: new Date(1),
      archivedAt: new Date(2),
    })
    await secondResult
    await waitFor(() => expect(screen.pending(secondID)).toBe(false))
    expect(list.pending(firstID)).toBe(true)
    const failure: SessionNotFoundError = {
      _tag: "Session.NotFoundError",
      sessionID: firstID,
      message: "Original SDK rejection",
    }
    first.reject(failure)
    expect(await firstResult).toBe(failure)
    await waitFor(() => expect(screen.error(firstID)).toBe(failure))
    expect(list.pending(firstID)).toBe(false)
    expect(screen.error(secondID)).toBeUndefined()
    expect(other.error(firstID)).toBeUndefined()
    expect(update).toHaveBeenCalledTimes(2)
    expect(detail).not.toHaveBeenCalled()
    expect(query.getMutationCache().findAll({ mutationKey: [...key, "session", "update"], exact: true })).toHaveLength(
      2,
    )
  } finally {
    view.unmount()
    query.clear()
  }
})
