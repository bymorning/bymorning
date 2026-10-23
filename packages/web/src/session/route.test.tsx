import { ByMorning, type ByMorningClient, type SessionDetail, type SessionInfo } from "@bymorning/client"
import { Agent } from "@bymorning/schema/agent"
import { Project } from "@bymorning/schema/project"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library"
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createEffect, Suspense, type ParentProps } from "solid-js"

import { DialogProvider } from "../context/dialog"
import { TestDataProvider as DataProvider } from "../context/test-data-provider"
import { SDKProvider } from "../context/sdk"
import { SettingsProvider } from "../context/settings"
import { WorkspaceScope } from "../context/workspace"
import { WorkspaceEventProvider } from "../test/workspace-event"
import { WorkspaceRuntimeProvider } from "../context/workspace-runtime"
import { CommandProvider } from "../shell/commands/context"
import { LayoutProvider } from "../shell/state/layout"
import { useServer } from "../runtime/server/runtime"
import { SessionRoute } from "./route"

const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Test",
  status: "active",
  role: "admin",
})
const projectID = Project.ID.create()
const firstID = Session.ID.make("00000000-0000-4000-8000-000000000001")
const secondID = Session.ID.make("00000000-0000-4000-8000-000000000002")
const missingID = Session.ID.make("00000000-0000-4000-8000-000000000003")
const model = { id: "model", provider: Provider.Name.make("test") }
const usage = {
  cost: 0,
  costComplete: true,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
}

const detail = (id: Session.ID, title: string): SessionDetail => ({
  id,
  projectID,
  title,
  agent: Agent.DefaultID,
  model,
  createdAt: new Date(0),
  updatedAt: new Date(1),
  usage,
})

const details = new Map<Session.ID, SessionDetail>([
  [firstID, detail(firstID, "First session")],
  [secondID, detail(secondID, "Second session")],
])

function clientWith(input: { readonly get?: (sessionID: Session.ID) => Promise<SessionDetail> } = {}) {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  return {
    ...base,
    message: { ...base.message, list: vi.fn().mockResolvedValue({ data: [], cursor: {} }) },
    project: { ...base.project, list: vi.fn().mockResolvedValue([]) },
    agent: { ...base.agent, list: vi.fn().mockResolvedValue([]) },
    provider: { ...base.provider, list: vi.fn().mockResolvedValue([]) },
    model: { ...base.model, list: vi.fn().mockResolvedValue([]) },
    skill: { ...base.skill, list: vi.fn().mockResolvedValue([]) },
    permission: {
      ...base.permission,
      list: vi.fn().mockResolvedValue([]),
      request: { ...base.permission.request, list: vi.fn().mockResolvedValue([]) },
    },
    form: { ...base.form, list: vi.fn().mockResolvedValue([]) },
    session: {
      ...base.session,
      active: vi.fn().mockResolvedValue({}),
      inbox: { ...base.session.inbox, list: vi.fn().mockResolvedValue([]) },
      list: vi.fn().mockResolvedValue({ data: [] }),
      get: (input.get ??
        vi.fn(({ sessionID }) => {
          const found = details.get(sessionID)
          if (!found) return Promise.reject({ _tag: "Session.NotFoundError", sessionID, message: "not found" })
          return Promise.resolve(found)
        })) as unknown as typeof base.session.get,
    },
    event: {
      ...base.event,
      subscribe: vi.fn(((_input, options) =>
        (async function* () {
          yield { id: "00000000-0000-4000-8000-000000000000" as never, type: "server.connected" as const, data: {} }
          const signal = options?.signal ?? AbortSignal.abort()
          if (signal.aborted) return
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })()) as typeof base.event.subscribe),
    },
  } satisfies ByMorningClient
}

function mount(client: ByMorningClient, initialPath: string) {
  vi.spyOn(ByMorning, "make").mockReturnValue(client)
  const history = createMemoryHistory()
  history.set({ value: initialPath })
  const view = render(() => (
    <SDKProvider>
      <SettingsProvider>
        <DialogProvider>
          <CommandProvider>
            <WorkspaceRuntimeProvider>
              <WorkspaceScope list={[workspace]} current={workspace}>
                <WorkspaceEventProvider>
                  <DataProvider>
                    <LayoutProvider>
                      <MemoryRouter history={history}>
                        <Route path="/session/:sessionID" component={SessionRoute} />
                      </MemoryRouter>
                    </LayoutProvider>
                  </DataProvider>
                </WorkspaceEventProvider>
              </WorkspaceScope>
            </WorkspaceRuntimeProvider>
          </CommandProvider>
        </DialogProvider>
      </SettingsProvider>
    </SDKProvider>
  ))
  return { client, history, unmount: view.unmount }
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  cleanup()
})

describe("SessionRoute", () => {
  it("rejects a URL sessionID that is not a valid Session identity", async () => {
    const mounted = mount(clientWith(), "/session/not-a-uuid")

    expect(await screen.findByRole("alert")).toHaveTextContent("This session cannot be found.")
    expect(mounted.client.session.get).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "Return to Overview" }))
    expect(mounted.history.get()).toBe(`/w/${workspace.id}`)
    mounted.unmount()
  })

  it("resolves a known-or-fetched session and renders the session screen", async () => {
    const get = Promise.withResolvers<SessionDetail>()
    const mounted = mount(clientWith({ get: () => get.promise as Promise<SessionDetail> }), `/session/${firstID}`)

    expect(screen.getByRole("status", { name: "Loading session..." })).toBeInTheDocument()
    get.resolve(detail(firstID, "Fetched session"))

    expect(await screen.findByText("Fetched session")).toBeInTheDocument()
    expect(document.querySelector('[data-component="session-workspace"]')).toBeInTheDocument()
    expect(screen.queryByRole("status", { name: "Loading session..." })).not.toBeInTheDocument()
    mounted.unmount()
  })

  it("shows the not-found state for an unknown session and returns to the overview", async () => {
    const failure = Promise.withResolvers<SessionDetail>()
    const mounted = mount(
      clientWith({ get: vi.fn(() => failure.promise as Promise<SessionDetail>) }),
      `/session/${missingID}`,
    )
    await waitFor(() => expect(mounted.client.session.get).toHaveBeenCalledOnce())

    failure.reject({ _tag: "Session.NotFoundError", sessionID: missingID, message: "not found" })

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("This session cannot be found.")
    await userEvent.click(screen.getByRole("button", { name: "Return to Overview" }))
    expect(mounted.history.get()).toBe(`/w/${workspace.id}`)
    mounted.unmount()
  })

  it("shows a recoverable load-failure state for other resolution errors", async () => {
    const failure = Promise.withResolvers<SessionDetail>()
    const get = vi.fn(() => failure.promise as Promise<SessionDetail>)
    const mounted = mount(clientWith({ get }), `/session/${firstID}`)
    await waitFor(() => expect(mounted.client.session.get).toHaveBeenCalledOnce())

    failure.reject(new Error("Gateway down"))

    expect(await screen.findByRole("alert")).toHaveTextContent("Gateway down")
    get.mockImplementation(() => Promise.resolve(detail(firstID, "Recovered session")))
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("Recovered session")).toBeInTheDocument()
    mounted.unmount()
  })

  it("re-resolves and remounts the screen when the URL sessionID changes", async () => {
    const mounted = mount(clientWith(), `/session/${firstID}`)
    expect(await screen.findByText("First session")).toBeInTheDocument()
    expect(mounted.client.session.get).toHaveBeenCalledTimes(1)

    mounted.history.set({ value: `/session/${secondID}` })

    expect(await screen.findByText("Second session")).toBeInTheDocument()
    expect(mounted.client.session.get).toHaveBeenCalledTimes(2)
    expect(mounted.client.session.get).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionID: secondID }),
      expect.anything(),
    )
    mounted.unmount()
  })

  it("renders a switched-to session whose shared record was observed before the navigation transition", async () => {
    const client = clientWith()
    vi.spyOn(ByMorning, "make").mockReturnValue(client)
    const history = createMemoryHistory()
    history.set({ value: `/session/${firstID}` })
    // As in the Shell, a sidebar row already observes the target Session's shared
    // record and a Suspense boundary holds the navigation transition open.
    const Observer = (props: ParentProps) => {
      const server = useServer()
      createEffect(() => void server.data.session.message.list(secondID))
      return <Suspense>{props.children}</Suspense>
    }
    const view = render(() => (
      <SDKProvider>
        <SettingsProvider>
          <DialogProvider>
            <CommandProvider>
              <WorkspaceRuntimeProvider>
                <WorkspaceScope list={[workspace]} current={workspace}>
                  <WorkspaceEventProvider>
                    <DataProvider>
                      <LayoutProvider>
                        <MemoryRouter history={history} root={Observer}>
                          <Route path="/session/:sessionID" component={SessionRoute} />
                        </MemoryRouter>
                      </LayoutProvider>
                    </DataProvider>
                  </WorkspaceEventProvider>
                </WorkspaceScope>
              </WorkspaceRuntimeProvider>
            </CommandProvider>
          </DialogProvider>
        </SettingsProvider>
      </SDKProvider>
    ))
    expect(await screen.findByText("First session")).toBeInTheDocument()

    history.set({ value: `/session/${secondID}` })

    expect(await screen.findByText("Second session")).toBeInTheDocument()
    expect(screen.queryByText(/Cannot read properties/)).not.toBeInTheDocument()
    view.unmount()
  })
})
