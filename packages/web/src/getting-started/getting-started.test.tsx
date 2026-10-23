import {
  ByMorning,
  type ByMorningClient,
  type ProviderDirectoryEntry,
  type SessionInfo,
  type ServiceAccountListOutput,
} from "@bymorning/client"
import { Agent } from "@bymorning/schema/agent"
import { Project } from "@bymorning/schema/project"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { createMemoryHistory, MemoryRouter, Route, useLocation } from "@solidjs/router"
import { cleanup, screen, waitFor, within } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { onMount, type JSX, type ParentProps } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CommandProvider } from "../shell/commands/context"
import { DialogProvider } from "../context/dialog"
import { SDKProvider } from "../context/sdk"
import { SettingsProvider } from "../context/settings"
import { TestDataProvider as DataProvider } from "../context/test-data-provider"
import { WorkspaceScope } from "../context/workspace"
import { WorkspaceRuntimeProvider } from "../context/workspace-runtime"
import { HomeRoute } from "../home/route"
import { ProjectProvider } from "../project/model"
import { SessionListProvider } from "../project/session-list"
import { useServer } from "../runtime/server/runtime"
import type { SyncStorage } from "../runtime/persistence/storage"
import { LayoutProvider } from "../shell/state/layout"
import { renderForm as render } from "../ui/form-query.test-support"
import { Toast, toaster } from "../ui/components/toast"
import { WorkspaceRoutePath } from "../workspace-route-paths"
import { createGettingStartedPreference, preferenceTarget } from "./model"

const admin = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Test",
  status: "active",
  role: "admin",
})
const member = WorkspaceAccess.Info.make({ ...admin, role: "member" })
const project = Project.Info.make({ id: Project.ID.create(), name: "Default", time_created: 1, time_updated: 1 })
const session: SessionInfo = {
  id: Session.ID.make("11111111-0000-4000-8000-000000000001"),
  projectID: project.id,
  title: "First",
  agent: Agent.DefaultID,
  model: { id: "model", provider: Provider.Name.make("anthropic") },
  createdAt: new Date(0),
  updatedAt: new Date(0),
}
const anthropic: ProviderDirectoryEntry = {
  info: { name: Provider.Name.make("anthropic"), displayName: "Anthropic", format: "anthropic", status: "auto" },
  integration: {
    id: "anthropic" as ProviderDirectoryEntry["info"]["name"] & never,
    name: "Anthropic",
    methods: [],
    connections: [],
  },
  active: false,
  connected: false,
  connectionCount: 0,
  modelCount: 12,
}
const account: ServiceAccountListOutput[number] = {
  id: "sac_1" as ServiceAccountListOutput[number]["id"],
  workspaceID: admin.id,
  name: "CI",
  status: "active",
  policy: {},
  timeCreated: new Date(0),
  timeUpdated: new Date(0),
  keyCount: 1,
}

const values = new Map<string, string>()
const storage: SyncStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
}

function clientWith(
  input: {
    providers?: ReadonlyArray<ProviderDirectoryEntry>
    sessions?: ReadonlyArray<SessionInfo>
    limit?: number
    accounts?: ReadonlyArray<ServiceAccountListOutput[number]>
    serviceAccount?: Partial<ByMorningClient["serviceAccount"]>
    servers?: ReadonlyArray<never>
  } = {},
) {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  const period = { start: new Date(0), end: new Date(1) }
  return {
    ...base,
    model: { ...base.model, list: vi.fn().mockResolvedValue([]) },
    provider: { ...base.provider, list: vi.fn().mockResolvedValue([...(input.providers ?? [])]) },
    event: {
      ...base.event,
      subscribe: (_input, options) =>
        (async function* () {
          yield { id: "00000000-0000-4000-8000-000000000099" as never, type: "server.connected" as const, data: {} }
          await new Promise<void>((resolve) =>
            options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
          )
        })(),
    },
    project: {
      ...base.project,
      list: vi.fn().mockResolvedValue([Project.Info.make({ ...project })]),
      directory: { ...base.project.directory, list: vi.fn().mockResolvedValue({ paths: [] }) },
    },
    session: {
      ...base.session,
      list: vi.fn().mockResolvedValue({ data: [...(input.sessions ?? [])] }),
      active: vi.fn().mockResolvedValue({}),
    },
    permission: { ...base.permission, request: { ...base.permission.request, list: vi.fn().mockResolvedValue([]) } },
    agent: { ...base.agent, list: vi.fn().mockResolvedValue([]) },
    skill: { ...base.skill, list: vi.fn().mockResolvedValue([]) },
    budget: {
      ...base.budget,
      status: vi.fn().mockResolvedValue({
        period,
        standings: [
          {
            target: { type: "workspace" as const },
            holder: "workspace" as never,
            period,
            spent: 0,
            ...(input.limit === undefined ? {} : { limit: input.limit }),
          },
        ],
      }),
    },
    serviceAccount: {
      ...base.serviceAccount,
      list: vi.fn().mockResolvedValue([...(input.accounts ?? [])]),
      ...input.serviceAccount,
    },
    mcp: {
      ...base.mcp,
      servers: { ...base.mcp.servers, list: vi.fn().mockResolvedValue([...(input.servers ?? [])]) },
    },
  } satisfies ByMorningClient
}

function mount(client: ByMorningClient, current: WorkspaceAccess.Info = admin, path = "") {
  vi.stubGlobal("localStorage", storage)
  vi.spyOn(ByMorning, "make").mockReturnValue(client)
  function Shell(props: ParentProps): JSX.Element {
    const location = useLocation()
    return (
      <WorkspaceRuntimeProvider>
        <output data-testid="location">{location.pathname}</output>
        <Toast.Region />
        {props.children}
      </WorkspaceRuntimeProvider>
    )
  }
  function Hydrate() {
    const server = useServer()
    onMount(() => {
      server.connection.on("server.connected", () => {
        void server.bootstrap().catch(() => undefined)
      })
    })
    return null
  }
  const history = createMemoryHistory()
  history.set({ value: `/w/${current.id}${path}` })
  render(() => (
    <DialogProvider>
      <SDKProvider>
        <WorkspaceScope list={[current]} current={current}>
          <DataProvider>
            <Hydrate />
            <LayoutProvider storage={storage}>
              <SettingsProvider storage={storage}>
                <CommandProvider>
                  <MemoryRouter history={history}>
                    <Route component={Shell}>
                      <Route
                        path="/w/:workspaceID"
                        component={(props) => (
                          <ProjectProvider>
                            <SessionListProvider>{props.children}</SessionListProvider>
                          </ProjectProvider>
                        )}
                      >
                        <Route path={WorkspaceRoutePath.overview} component={HomeRoute} />
                      </Route>
                    </Route>
                  </MemoryRouter>
                </CommandProvider>
              </SettingsProvider>
            </LayoutProvider>
          </DataProvider>
        </WorkspaceScope>
      </SDKProvider>
    </DialogProvider>
  ))
  return { location: () => screen.getByTestId("location").textContent }
}

const preference = () => JSON.parse(values.get(preferenceTarget(admin.id).key) ?? "{}") as Record<string, unknown>

afterEach(() => {
  cleanup()
  values.clear()
  toaster.dismiss()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("Getting Started preference", () => {
  it("stores skips and dismissal per workspace without recording completion", () => {
    const first = createGettingStartedPreference(admin.id, storage)
    first.skip("budget")
    first.dismiss()
    expect(first.skipped("budget")).toBe(true)
    expect(first.skipped("tools")).toBe(false)
    expect(first.dismissed()).toBe(true)
    first.unskip("budget")
    first.restore()
    expect(first.skipped("budget")).toBe(false)
    expect(first.dismissed()).toBe(false)

    const other = createGettingStartedPreference(Workspace.ID.create(), storage)
    first.skip("apps")
    expect(other.skipped("apps")).toBe(false)
  })
})

describe("Checklist", () => {
  it("is the whole Overview for an administrator whose workspace has neither a provider nor a session", async () => {
    const view = mount(clientWith({ providers: [anthropic] }))
    expect(await screen.findByRole("heading", { name: "Getting started" })).toBeInTheDocument()
    expect(view.location()).toBe(`/w/${admin.id}`)
    const list = screen.getByRole("list", { name: "Getting started steps" })
    const state = (step: string) => list.querySelector(`li[data-step="${step}"]`)?.getAttribute("data-state")
    await waitFor(() => expect(state("provider")).toBe("pending"))
    await waitFor(() => expect(state("session")).toBe("pending"))
    expect(screen.queryByRole("navigation", { name: "Sessions" })).not.toBeInTheDocument()
    // Nothing is stored until the person skips or dismisses something.
    expect(preference()).toEqual({})
  })

  it("says web search is disabled when the Installation Policy turns it off", async () => {
    const client = clientWith({ providers: [anthropic] })
    mount({
      ...client,
      "api.config": { ...client["api.config"], get: vi.fn().mockResolvedValue({ websearch: false }) },
    })
    expect(await screen.findByText("Web search is disabled by the Installation Policy.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Add web search" })).not.toBeInTheDocument()
    expect(screen.queryByText(/Give sessions web search/)).not.toBeInTheDocument()
    expect(screen.getByText("Connect an MCP server your team already uses.")).toBeInTheDocument()
  })

  it("never shows for members", async () => {
    const view = mount(clientWith({ providers: [anthropic] }), member)
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText("Nothing here yet")).toBeInTheDocument())
    expect(view.location()).toBe(`/w/${member.id}`)
    expect(screen.queryByRole("heading", { name: "Getting started" })).not.toBeInTheDocument()
  })

  it("keeps the new key visible after creating it completes the step", async () => {
    const created = { ...account, name: "Claude Code", keyCount: 0 }
    const list = vi
      .fn<ByMorningClient["serviceAccount"]["list"]>()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ ...created, keyCount: 1 }])
    const secret = "bms_live_9f8e7d6c5b4a3f2e1d0c"
    const client = clientWith({ providers: [anthropic] })
    mount({
      ...client,
      serviceAccount: {
        ...client.serviceAccount,
        list,
        create: vi.fn().mockResolvedValue(created),
        key: { ...client.serviceAccount.key, create: vi.fn().mockResolvedValue({ key: {}, secret }) },
      },
    })
    const steps = await screen.findByRole("list", { name: "Getting started steps" })
    const apps = () => steps.querySelector<HTMLElement>('li[data-step="apps"]')!
    await waitFor(() => expect(apps().getAttribute("data-state")).toBe("pending"))

    await userEvent.click(within(apps()).getByRole("button", { name: "Create API key" }))
    const dialog = screen.getByRole("dialog", { name: "Create API key" })
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Key name" }), "Claude Code")
    await userEvent.click(within(dialog).getByRole("button", { name: "Create key" }))

    // The refreshed list completes the step and unmounts its button; the reveal must outlive that.
    await waitFor(() => expect(apps().getAttribute("data-state")).toBe("done"))
    expect(screen.getByRole("dialog", { name: "Copy your API key" })).toBeInTheDocument()
    expect(screen.getByDisplayValue(secret)).toBeInTheDocument()
    // Budgets lists service accounts from budget standings, so creating one refreshes them too.
    await waitFor(() => expect(client.budget.status).toHaveBeenCalledTimes(2))
    await userEvent.click(screen.getByRole("button", { name: "Done" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("derives completion from workspace state and replaces the empty session list", async () => {
    mount(clientWith({ providers: [{ ...anthropic, active: true }], limit: 50, accounts: [account] }))
    const list = await screen.findByRole("list", { name: "Getting started steps" })
    await waitFor(() => expect(screen.getByText("3 of 6 complete")).toBeInTheDocument())
    const state = (step: string) => list.querySelector(`li[data-step="${step}"]`)?.getAttribute("data-state")
    await waitFor(() => expect(state("session")).toBe("pending"))
    expect(state("provider")).toBe("done")
    expect(state("budget")).toBe("done")
    expect(state("tools")).toBe("pending")
    expect(state("skills")).toBe("pending")
    expect(state("apps")).toBe("done")
    expect(screen.queryByRole("navigation", { name: "Sessions" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Invite members" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Configure SSO" })).toBeInTheDocument()
  })

  it("announces completion when the last open step resolves", async () => {
    mount(clientWith({ providers: [{ ...anthropic, active: true }], sessions: [session], limit: 50 }))
    const steps = await screen.findByRole("list", { name: "Getting started steps" })
    await waitFor(() => expect(screen.getByText("3 of 6 complete")).toBeInTheDocument())
    expect(screen.queryByText("Getting started complete")).not.toBeInTheDocument()
    for (const id of ["skills", "tools", "apps"]) {
      await userEvent.click(steps.querySelector(`li[data-step="${id}"] [data-action="getting-started-skip"]`)!)
    }
    expect(await screen.findByText("Getting started complete")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Getting started" })).not.toBeInTheDocument()
  })

  it("stays quiet when the checklist loads already complete", async () => {
    mount(
      clientWith({
        providers: [{ ...anthropic, active: true }],
        sessions: [session],
        limit: 50,
        accounts: [account],
      }),
    )
    await screen.findByRole("heading", { name: "Getting started" })
    await waitFor(() => expect(screen.getByText("4 of 6 complete")).toBeInTheDocument())
    expect(screen.queryByText("Getting started complete")).not.toBeInTheDocument()
  })

  it("skips, restores, and dismisses through the browser-local preference", async () => {
    mount(clientWith({ providers: [anthropic], sessions: [session] }))
    await screen.findByRole("heading", { name: "Getting started" })
    await waitFor(() => expect(screen.getByText("1 of 6 complete")).toBeInTheDocument())
    expect(screen.getByRole("navigation", { name: "Sessions" })).toBeInTheDocument()

    const budget = screen.getByRole("list", { name: "Getting started steps" }).querySelector('li[data-step="budget"]')!
    await userEvent.click(budget.querySelector('[data-action="getting-started-skip"]')!)
    expect(budget.getAttribute("data-state")).toBe("skipped")
    expect(screen.getByText("2 of 6 complete")).toBeInTheDocument()
    await userEvent.click(budget.querySelector('[data-action="getting-started-unskip"]')!)
    expect(budget.getAttribute("data-state")).toBe("pending")

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }))
    expect(screen.queryByRole("heading", { name: "Getting started" })).not.toBeInTheDocument()
    expect(preference()).toMatchObject({ checklist: "dismissed" })
  })
})
