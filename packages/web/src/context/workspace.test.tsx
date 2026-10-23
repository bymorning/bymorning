import { ByMorning } from "@bymorning/client"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router"
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { type JSX } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkspaceProvider } from "../shell/routes/workspace"
import { SDKProvider } from "./sdk"
import { useWorkspace, WorkspaceScope } from "./workspace"

const first = WorkspaceAccess.Info.make({ id: Workspace.ID.create(), name: "First", status: "active", role: "admin" })
const second = WorkspaceAccess.Info.make({ id: Workspace.ID.create(), name: "Second", status: "active", role: "admin" })

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("WorkspaceProvider", () => {
  it("exposes the non-optional Workspace resolved by the route and all admitted options", () => {
    function Consumer(): JSX.Element {
      const workspace = useWorkspace()
      return <output>{`${workspace.current().name}:${workspace.list().length}`}</output>
    }

    render(() => (
      <WorkspaceScope list={[first, second]} current={second}>
        <Consumer />
      </WorkspaceScope>
    ))

    expect(screen.getByText("Second:2")).toBeInTheDocument()
  })

  it("rejects consumers outside the provider", () => {
    expect(() => useWorkspace()).toThrow("Workspace context must be used within a context provider")
  })

  it("selects the first Workspace from the application root", async () => {
    const history = createMemoryHistory()
    history.set({ value: "/" })
    const client = ByMorning.make({ baseUrl: "http://localhost" })
    vi.spyOn(ByMorning, "make").mockReturnValue({
      ...client,
      workspace: { ...client.workspace, list: vi.fn().mockResolvedValue([first, second]) },
    })

    render(() => (
      <SDKProvider>
        <MemoryRouter history={history}>
          <Route component={WorkspaceProvider}>
            <Route path="/" />
            <Route path="/w/:workspaceID" component={() => <p>Workspace</p>} />
          </Route>
        </MemoryRouter>
      </SDKProvider>
    ))

    await waitFor(() => expect(history.get()).toBe(`/w/${first.id}`))
    expect(screen.getByText("Workspace")).toBeInTheDocument()
    expect(screen.queryByText("Loading workspaces…")).not.toBeInTheDocument()
  })

  it("shows empty shell chrome while the workspace list is pending on /", () => {
    const history = createMemoryHistory()
    history.set({ value: "/" })
    const client = ByMorning.make({ baseUrl: "http://localhost" })
    vi.spyOn(ByMorning, "make").mockReturnValue({
      ...client,
      workspace: {
        ...client.workspace,
        list: vi.fn(() => new Promise<typeof first[]>(() => {})),
      },
    })

    render(() => (
      <SDKProvider>
        <MemoryRouter history={history}>
          <Route component={WorkspaceProvider}>
            <Route path="/" />
            <Route path="/w/:workspaceID" component={() => <p>Workspace</p>} />
          </Route>
        </MemoryRouter>
      </SDKProvider>
    ))

    expect(document.querySelector('[data-component="shell"]')).toBeInTheDocument()
    expect(document.querySelector('[data-slot="project-sidebar"]')).toBeEmptyDOMElement()
    expect(document.querySelector('[data-slot="shell-content"]')).toBeEmptyDOMElement()
    expect(screen.queryByText("Loading workspaces…")).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(history.get()).toBe("/")
  })

  it("shows empty shell chrome while the workspace list is pending on an unknown /w/:id", () => {
    const history = createMemoryHistory()
    history.set({ value: `/w/${Workspace.ID.create()}` })
    const client = ByMorning.make({ baseUrl: "http://localhost" })
    vi.spyOn(ByMorning, "make").mockReturnValue({
      ...client,
      workspace: {
        ...client.workspace,
        list: vi.fn(() => new Promise<typeof first[]>(() => {})),
      },
    })

    render(() => (
      <SDKProvider>
        <MemoryRouter history={history}>
          <Route component={WorkspaceProvider}>
            <Route path="/" />
            <Route path="/w/:workspaceID" component={() => <p>Workspace</p>} />
          </Route>
        </MemoryRouter>
      </SDKProvider>
    ))

    expect(document.querySelector('[data-component="shell"]')).toBeInTheDocument()
    expect(document.querySelector('[data-slot="project-sidebar"]')).toBeEmptyDOMElement()
    expect(document.querySelector('[data-slot="shell-content"]')).toBeEmptyDOMElement()
    expect(screen.queryByText("Loading workspaces…")).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("keeps Retry when the workspace list fails", async () => {
    const history = createMemoryHistory()
    history.set({ value: "/" })
    const client = ByMorning.make({ baseUrl: "http://localhost" })
    vi.spyOn(ByMorning, "make").mockReturnValue({
      ...client,
      workspace: { ...client.workspace, list: vi.fn().mockRejectedValue(new Error("offline")) },
    })

    render(() => (
      <SDKProvider>
        <MemoryRouter history={history}>
          <Route component={WorkspaceProvider}>
            <Route path="/" />
          </Route>
        </MemoryRouter>
      </SDKProvider>
    ))

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load workspaces.")
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
    expect(screen.queryByText("Loading workspaces…")).not.toBeInTheDocument()
  })

  it("redirects an unauthorized root request to Login", async () => {
    const history = createMemoryHistory()
    history.set({ value: "/" })
    const client = ByMorning.make({ baseUrl: "http://localhost" })
    vi.spyOn(ByMorning, "make").mockReturnValue({
      ...client,
      workspace: {
        ...client.workspace,
        list: vi.fn().mockRejectedValue({ _tag: "UnauthorizedError", message: "Unauthorized" }),
      },
    })

    render(() => (
      <SDKProvider>
        <MemoryRouter history={history}>
          <Route path="/login" component={() => <p>Login</p>} />
          <Route component={WorkspaceProvider}>
            <Route path="/" />
          </Route>
        </MemoryRouter>
      </SDKProvider>
    ))

    await waitFor(() => expect(history.get()).toBe("/login"))
    expect(screen.getByText("Login")).toBeInTheDocument()
  })
})
