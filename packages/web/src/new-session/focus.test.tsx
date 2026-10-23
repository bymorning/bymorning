import { ByMorning, type ByMorningClient } from "@bymorning/client"
import { Agent } from "@bymorning/schema/agent"
import { Event } from "@bymorning/schema/event"
import { Project } from "@bymorning/schema/project"
import { Provider } from "@bymorning/schema/provider"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library"
import { onMount, type JSX, type ParentProps } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"

import { DataProvider } from "../context/data"
import { DialogProvider } from "../context/dialog"
import { SDKProvider } from "../context/sdk"
import { SettingsProvider } from "../context/settings"
import { WorkspaceScope } from "../context/workspace"
import { WorkspaceEventProvider } from "../context/workspace-event"
import { WorkspaceRuntimeProvider } from "../context/workspace-runtime"
import { ProjectProvider, useProject } from "../project/model"
import { CommandProvider, useCommand } from "../shell/commands/context"
import { createGlobalCommands } from "../shell/commands/registry/global"
import { NewSessionRoute } from "./route"
import { ServerProvider, useServer } from "../runtime/server/runtime"

const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Test",
  status: "active",
  role: "admin",
})
const projectID = Project.ID.create()
const enabledName = Provider.Name.make("enabled")
const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  cleanup()
})

function client() {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  return {
    ...base,
    agent: {
      ...base.agent,
      list: vi.fn().mockResolvedValue([
        {
          id: Agent.DefaultID,
          name: Agent.Name.make("Default"),
          instructions: "",
          model: { provider: enabledName, id: "alpha" },
          mode: "primary",
          hidden: false,
          steps: null,
          permissions: [],
        },
      ]),
    },
    provider: {
      ...base.provider,
      list: vi.fn().mockResolvedValue([
        {
          info: {
            name: enabledName,
            displayName: "Enabled",
            api: Provider.API.make("https://example.com"),
            format: "openai" as const,
            status: "enabled" as const,
          },
          integration: { id: enabledName as unknown as never, name: "Enabled", methods: [], connections: [] },
          connected: true,
          active: true,
          connectionCount: 1,
          modelCount: 1,
        },
      ]),
    },
    model: {
      ...base.model,
      list: vi.fn().mockResolvedValue([
        {
          info: {
            id: "alpha",
            provider: enabledName,
            apiID: "alpha",
            name: "Alpha",
            description: "",
            status: "active" as const,
            releaseDate: "2026-01-01",
            lastUpdated: "2026-01-01",
            openWeights: false,
            capabilities: { temperature: true, reasoning: true, attachment: true, tools: true, input: [], output: [] },
            variants: [],
            limit: { context: 1, output: 1 },
            cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          },
          enabled: true,
          isPreferredDefault: false,
          isEffectiveDefault: false,
        },
      ]),
    },
    skill: { ...base.skill, list: vi.fn().mockResolvedValue([]) },
    project: {
      ...base.project,
      list: vi.fn().mockResolvedValue([
        Project.Info.make({ id: projectID, name: "Project", time_created: 1, time_updated: 1 }),
      ]),
    },
    session: {
      ...base.session,
      list: vi.fn().mockResolvedValue({ data: [] }),
      active: vi.fn().mockResolvedValue({}),
    },
    event: {
      ...base.event,
      subscribe: vi.fn((async function* () {
        yield { id: Event.ID.make(crypto.randomUUID()), type: "server.connected" as const, data: {} }
        await new Promise(() => {})
      }) as unknown as ByMorningClient["event"]["subscribe"]),
    },
  } satisfies ByMorningClient
}

let project!: ReturnType<typeof useProject>

/** Mirrors the real shell: bootstrap on connect, global commands, and a persistent trigger. */
function Shell(props: ParentProps): JSX.Element {
  onMount(() => {
    const server = useServer()
    server.connection.on("server.connected", () => void server.bootstrap().catch(() => undefined))
  })
  return (
    <WorkspaceRuntimeProvider>
      <WorkspaceScope list={[workspace]} current={workspace}>
        <WorkspaceEventProvider>
          <DataProvider>
            <SettingsProvider storage={storage}>
              <DialogProvider>
                <CommandProvider>
                  <GlobalCommands />
                  <ProjectProvider>
                    <CaptureProject />
                    <button type="button">Trigger</button>
                    {props.children}
                  </ProjectProvider>
                </CommandProvider>
              </DialogProvider>
            </SettingsProvider>
          </DataProvider>
        </WorkspaceEventProvider>
      </WorkspaceScope>
    </WorkspaceRuntimeProvider>
  )
}

function GlobalCommands(): JSX.Element {
  useCommand().register("global", createGlobalCommands())
  return null
}

function CaptureProject(): JSX.Element {
  project = useProject()
  return null
}

function mount(home: () => JSX.Element) {
  const api = client()
  vi.spyOn(ByMorning, "make").mockReturnValue(api)
  const history = createMemoryHistory()
  history.set({ value: `/w/${workspace.id}` })
  render(() => (
    <QueryClientProvider client={new QueryClient()}>
      <ServerProvider scope={{ origin: "http://localhost", identity: "test", workspace: workspace.id, api }}>
        <SDKProvider>
          <MemoryRouter history={history}>
            <Route path={`/w/${workspace.id}`} component={Shell}>
              <Route path="/" component={home} />
              <Route path="/new-session" component={NewSessionRoute} />
            </Route>
          </MemoryRouter>
        </SDKProvider>
      </ServerProvider>
    </QueryClientProvider>
  ))
}

it("focuses the composer after starting a new session from the sidebar button", async () => {
  function Home(): JSX.Element {
    return (
      <button type="button" onClick={() => project.session.create()}>
        New Session
      </button>
    )
  }
  mount(Home)

  const trigger = await screen.findByRole("button", { name: "New Session" })
  trigger.focus()
  await waitFor(() => expect(project.session.canCreate()).toBe(true))
  fireEvent.click(trigger)

  const editor = await screen.findByRole("combobox", { name: "Message" })
  await waitFor(() => expect(editor).toHaveFocus())
  // The composer's deferred autofocus must also survive anything that settles after it.
  await new Promise((resolve) => setTimeout(resolve, 200))
  expect(editor).toHaveFocus()
})

it("keeps focus on the composer after starting a new session from the command palette", async () => {
  mount(() => <p>Somewhere else</p>)

  const trigger = await screen.findByRole("button", { name: "Trigger" })
  trigger.focus()
  await waitFor(() => expect(project.session.canCreate()).toBe(true))

  fireEvent.keyDown(window, { key: "k", ctrlKey: true })
  await screen.findByRole("dialog", { name: "Commands" })
  fireEvent.input(screen.getByRole("combobox", { name: "Search commands" }), { target: { value: "New session" } })
  fireEvent.click(await screen.findByRole("option", { name: "New session" }))

  const editor = await screen.findByRole("combobox", { name: "Message" })
  await waitFor(() => expect(editor).toHaveFocus())
  // The palette dialog finishes closing ~100ms later and must not steal focus back.
  await new Promise((resolve) => setTimeout(resolve, 200))
  expect(editor).toHaveFocus()
})
