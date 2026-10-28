import {
  type AgentListOutput,
  ByMorning,
  type ByMorningClient,
  type SessionInfo,
  type SkillListOutput,
} from "@bymorning/client"
import { Agent } from "@bymorning/schema/agent"
import { Project } from "@bymorning/schema/project"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import { Skill } from "@bymorning/schema/skill"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { createMemoryHistory, MemoryRouter, Route, useLocation, useNavigate } from "@solidjs/router"
import { cleanup, screen, waitFor, within } from "@solidjs/testing-library"
import { renderForm as render } from "../ui/form-query.test-support"
import userEvent from "@testing-library/user-event"
import { onMount, type JSX, type ParentProps } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useCommand, CommandProvider } from "../shell/commands/context"
import { skillLibrary } from "./skills/library/catalog"
import { useData } from "../context/data"
import { TestDataProvider as DataProvider } from "../context/test-data-provider"
import { useServer } from "../runtime/server/runtime"
import { DialogProvider } from "../context/dialog"
import { OverlayHost } from "../ui/components/overlay-host"
import { Toast } from "../ui/components/toast"
import { SessionListProvider } from "../project/session-list"
import { ProjectProvider, useProject, type ProjectModel } from "../project/model"
import { SidebarProjectsRegion } from "../project/sidebar/projects-region"
import { ProjectSidebarRegion } from "../project/sidebar/region"
import { workspaceRoutes } from "../project/sidebar/navigation"
import { SDKProvider } from "../context/sdk"
import { SettingsProvider } from "../context/settings"
import { WorkspaceRuntimeProvider } from "../context/workspace-runtime"
import { WorkspaceScope } from "../context/workspace"
import { LayoutProvider } from "../shell/state/layout"
import type { SyncStorage } from "../runtime/persistence/storage"
import { HomeRoute } from "./route"
import { preferenceTarget } from "../getting-started/model"
import { AgentsRoute } from "./agents/route"
import { SkillsRoute } from "./skills/route"
import { ProjectRoute } from "../project/route"
import { LegacyProjectRoute } from "../project/legacy-route"
import { normalizePathname, workspaceRouteHref, WorkspaceRoutePath } from "../workspace-route-paths"
import { toaster } from "../ui/components/toast"

const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Test",
  status: "active",
  role: "admin",
})
const first = Project.Info.make({ id: Project.ID.create(), name: "First", time_created: 1, time_updated: 1 })
const second = Project.Info.make({ id: Project.ID.create(), name: "Second", time_created: 2, time_updated: 2 })

/**
 * List resolutions are handed straight to Data's store reconciliation, which
 * rewrites reconciled rows in place on later resolution. Serve fresh copies so
 * the shared fixtures stay untouched across tests.
 */
const fresh = (projects: readonly [Project.Info, ...Project.Info[]] | readonly Project.Info[]) =>
  projects.map((project) => Project.Info.make({ ...project }))
const skill: SkillListOutput[number] = {
  id: Skill.ID.make("review"),
  name: "Review",
  description: "Review code",
  instructions: "## Review carefully\n\nCheck every change.",
}
const agent: AgentListOutput[number] = {
  id: Agent.ID.make("reviewer"),
  name: Agent.Name.make("Reviewer"),
  description: "Reviews code",
  instructions: "## Review carefully\n\nCheck every change.",
  mode: "subagent",
  hidden: false,
  steps: 10,
  permissions: [],
}
const defaultAgent: AgentListOutput[number] = {
  id: Agent.DefaultID,
  name: Agent.Name.make("Default"),
  description: "The primary chat agent that orchestrates for the user.",
  instructions: "Shipped default instructions.",
  mode: "primary",
  hidden: false,
  steps: null,
  permissions: [],
  overridden: false,
}
const session = (id: string, projectID: Project.ID): SessionInfo => ({
  id: Session.ID.make(id),
  projectID,
  title: `Session ${id.slice(0, 8)}`,
  agent: Agent.DefaultID,
  model: { id: "model", provider: Provider.Name.make("test") },
  createdAt: new Date(0),
  updatedAt: new Date(0),
})
const values = new Map<string, string>()
const storage: SyncStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
}

function mount(client: ByMorningClient, path = "") {
  vi.stubGlobal("localStorage", storage)
  // These tests cover the regular Overview; Getting Started has its own tests.
  storage.setItem(preferenceTarget(workspace.id).key, JSON.stringify({ checklist: "dismissed", skipped: {} }))
  vi.spyOn(ByMorning, "make").mockReturnValue({
    ...client,
    session: { ...client.session, active: vi.fn().mockResolvedValue({}) },
    permission: {
      ...client.permission,
      request: { ...client.permission.request, list: vi.fn().mockResolvedValue([]) },
    },
  })
  let command!: ReturnType<typeof useCommand>
  let projectController!: ProjectModel
  let dismissals = 0
  let ready = () => false
  function Shell(props: ParentProps): JSX.Element {
    const location = useLocation()
    return (
      <WorkspaceRuntimeProvider>
        <output data-testid="location">{location.pathname}</output>
        <Toast.Region />
        <OverlayHost>{props.children}</OverlayHost>
      </WorkspaceRuntimeProvider>
    )
  }
  function Page(props: ParentProps): JSX.Element {
    command = useCommand()
    projectController = useProject()
    const location = useLocation()
    const navigate = useNavigate()
    return (
      <>
        <ProjectSidebarRegion
          onDismiss={() => dismissals++}
          projects={<SidebarProjectsRegion onDismiss={() => dismissals++} storage={storage} />}
          routes={workspaceRoutes.map((route) => {
            const href = workspaceRouteHref(workspace.id, route.path)
            return {
              ...route,
              active: normalizePathname(location.pathname) === href,
              onSelect: () => {
                navigate(href)
                dismissals++
              },
            }
          })}
        />
        {props.children}
      </>
    )
  }
  function Hydrate() {
    const server = useServer()
    ready = () => server.bootstrapState().state === "ready"
    onMount(() => {
      server.connection.on("server.connected", () => {
        void server.bootstrap().catch(() => undefined)
      })
    })
    return null
  }
  const history = createMemoryHistory()
  history.set({ value: `/w/${workspace.id}${path}` })
  const view = render(() => (
    <DialogProvider>
      <SDKProvider>
        <WorkspaceScope list={[workspace]} current={workspace}>
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
                            <SessionListProvider>
                              <Page>{props.children}</Page>
                            </SessionListProvider>
                          </ProjectProvider>
                        )}
                      >
                        <Route path={WorkspaceRoutePath.overview} component={HomeRoute} />
                        <Route path={WorkspaceRoutePath.project} component={ProjectRoute} />
                        <Route path={WorkspaceRoutePath.legacyProjects} component={LegacyProjectRoute} />
                        <Route path={WorkspaceRoutePath.agents} component={AgentsRoute} />
                        <Route path={WorkspaceRoutePath.skills} component={SkillsRoute} />
                        <Route path={WorkspaceRoutePath.legacyFiles} component={LegacyProjectRoute} />
                        <Route path="/new-session" component={() => <p>Draft session</p>} />
                        <Route path={WorkspaceRoutePath.session} component={() => <p>Open session</p>} />
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
  return {
    ready: () => ready(),
    command: () => command,
    projectController: () => projectController,
    dismissals: () => dismissals,
    history,
    unmount: view.unmount,
  }
}

function clientWith(
  input: {
    projects?: ByMorningClient["project"]["list"]
    sessions?: ByMorningClient["session"]["list"]
    projectFiles?: ByMorningClient["project"]["directory"]["list"]
    readProjectFile?: ByMorningClient["project"]["directory"]["read"]
    writeProjectFile?: ByMorningClient["project"]["directory"]["write"]
    agents?: ByMorningClient["agent"]["list"]
    agentCreate?: ByMorningClient["agent"]["create"]
    agentUpdate?: ByMorningClient["agent"]["update"]
    agentDelete?: ByMorningClient["agent"]["delete"]
    skills?: ByMorningClient["skill"]["list"]
    skillCreate?: ByMorningClient["skill"]["create"]
    skillUpdate?: ByMorningClient["skill"]["update"]
    skillDelete?: ByMorningClient["skill"]["delete"]
    createSession?: ByMorningClient["session"]["create"]
    updateSession?: ByMorningClient["session"]["update"]
    createProject?: ByMorningClient["project"]["create"]
    updateProject?: ByMorningClient["project"]["update"]
  } = {},
) {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  return {
    ...base,
    model: { ...base.model, list: vi.fn().mockResolvedValue([]) },
    provider: { ...base.provider, list: vi.fn().mockResolvedValue([]) },
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
      list: input.projects ?? vi.fn().mockResolvedValue(fresh([first, second])),
      create: input.createProject ?? base.project.create,
      update: input.updateProject ?? base.project.update,
      directory: {
        ...base.project.directory,
        list: input.projectFiles ?? vi.fn().mockResolvedValue({ paths: [] }),
        read: input.readProjectFile ?? base.project.directory.read,
        write: input.writeProjectFile ?? base.project.directory.write,
      },
    },
    session: {
      ...base.session,
      list: input.sessions ?? vi.fn().mockResolvedValue({ data: [] }),
      create: input.createSession ?? base.session.create,
      update: input.updateSession ?? base.session.update,
    },
    agent: {
      ...base.agent,
      list: input.agents ?? vi.fn().mockResolvedValue([]),
      create: input.agentCreate ?? base.agent.create,
      update: input.agentUpdate ?? base.agent.update,
      delete: input.agentDelete ?? base.agent.delete,
    },
    skill: {
      ...base.skill,
      list: input.skills ?? vi.fn().mockResolvedValue([]),
      create: input.skillCreate ?? base.skill.create,
      update: input.skillUpdate ?? base.skill.update,
      delete: input.skillDelete ?? base.skill.delete,
    },
  } satisfies ByMorningClient
}

afterEach(() => {
  cleanup()
  values.clear()
  toaster.dismiss()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("Home", () => {
  it("loads Agents and opens and closes their details", async () => {
    const response = Promise.withResolvers<AgentListOutput>()
    const agents = vi.fn<ByMorningClient["agent"]["list"]>(() => response.promise)
    const mounted = mount(clientWith({ agents }))

    await userEvent.click(screen.getByRole("button", { name: "Agents" }))
    expect(within(document.querySelector('[data-component="home-agents"]')!).getByRole("status")).toHaveTextContent(
      "Loading agents",
    )
    expect(agents).toHaveBeenCalledWith({ workspace: workspace.id }, { signal: expect.any(AbortSignal) })

    response.resolve([agent])
    await waitFor(() => expect(mounted.ready()).toBe(true))
    expect(screen.queryByText("Available agents")).not.toBeInTheDocument()
    const open = await screen.findByRole("button", { name: "Open Reviewer details" })
    await waitFor(() => expect(open).toBeEnabled())
    await userEvent.click(open)
    expect(await screen.findByRole("dialog", { name: "Reviewer" })).toHaveTextContent("Review carefully")
    expect(screen.getByRole("dialog", { name: "Reviewer" })).toHaveTextContent("Check every change.")

    await userEvent.click(screen.getByRole("button", { name: "Close" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Reviewer" })).not.toBeInTheDocument())
  })

  it("edits the Default agent in place, then resets it to the shipped definition", async () => {
    // Tracks the Workspace record's presence, since Agents refetches at least
    // once before the person acts and again after every save and reset.
    let overridden = false
    const agents = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve([
          overridden ? { ...defaultAgent, instructions: "Workspace instructions.", overridden: true } : defaultAgent,
        ]),
      )
    const agentUpdate = vi.fn<ByMorningClient["agent"]["update"]>().mockImplementation(() => {
      overridden = true
      return Promise.resolve({ ...defaultAgent, instructions: "Workspace instructions.", overridden: true })
    })
    const agentDelete = vi.fn<ByMorningClient["agent"]["delete"]>().mockImplementation(() => {
      overridden = false
      return Promise.resolve(undefined)
    })
    mount(clientWith({ agents, agentUpdate, agentDelete }), "/agents")

    const open = await screen.findByRole("button", { name: "Open Default details" })
    await userEvent.click(open)
    expect(
      within(screen.getByRole("dialog", { name: "Default" })).queryByRole("button", { name: "Reset to built-in" }),
    ).not.toBeInTheDocument()

    // Editing swaps the dialog's own accessible name to "Edit agent".
    await userEvent.click(screen.getByRole("button", { name: "Edit agent" }))
    const instructions = screen.getByLabelText("Instructions")
    await userEvent.clear(instructions)
    await userEvent.type(instructions, "Workspace instructions.")
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }))

    expect(agentUpdate).toHaveBeenCalledWith({
      workspace: workspace.id,
      id: Agent.DefaultID,
      name: defaultAgent.name,
      instructions: "Workspace instructions.",
      description: defaultAgent.description,
      mode: defaultAgent.mode,
      hidden: defaultAgent.hidden,
      steps: defaultAgent.steps,
      permissions: defaultAgent.permissions,
    })
    expect(await screen.findByText("Agent Default saved")).toBeInTheDocument()
    const saved = await screen.findByRole("dialog", { name: "Default" })
    expect(await within(saved).findByRole("button", { name: "Reset to built-in" })).toBeInTheDocument()

    await userEvent.click(within(saved).getByRole("button", { name: "Reset to built-in" }))
    await userEvent.click(await screen.findByRole("button", { name: "Reset agent" }))

    expect(agentDelete).toHaveBeenCalledWith({ workspace: workspace.id, id: Agent.DefaultID })
    expect(await screen.findByText("Agent Default reset to built-in")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Default" })).not.toBeInTheDocument())
  })

  it("shows failed Agent requests and retries them", async () => {
    const firstRequest = Promise.withResolvers<AgentListOutput>()
    const agents = vi
      .fn<ByMorningClient["agent"]["list"]>()
      .mockImplementationOnce(() => firstRequest.promise)
      .mockResolvedValueOnce([agent])
    mount(clientWith({ agents }))

    await userEvent.click(screen.getByRole("button", { name: "Agents" }))
    expect(within(document.querySelector('[data-component="home-agents"]')!).getByRole("status")).toHaveTextContent(
      "Loading agents",
    )
    firstRequest.reject(new Error("Agents unavailable"))

    expect(await screen.findByRole("alert")).toHaveTextContent("Agents unavailable")
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByRole("button", { name: "Open Reviewer details" })).toBeInTheDocument()
    expect(agents).toHaveBeenCalledTimes(2)
  })

  it("creates an Agent from the creation form and restores trigger focus", async () => {
    const agentCreate = vi.fn<ByMorningClient["agent"]["create"]>().mockResolvedValue(agent)
    mount(clientWith({ agents: vi.fn().mockResolvedValue([agent]), agentCreate }), "/agents")
    const trigger = screen.getByRole("button", { name: "Add subagent" })

    await userEvent.click(trigger)
    const dialog = screen.getByRole("dialog", { name: "Create subagent" })
    const name = within(dialog).getByRole("textbox", { name: "Name" })
    expect(name).toHaveFocus()
    expect(name).toBeRequired()
    expect(within(dialog).getByRole("textbox", { name: "Description" })).toBeInTheDocument()
    expect(within(dialog).getByRole("textbox", { name: "Instructions" })).toBeInTheDocument()
    // Mode is not offered: every created Agent is a subagent.
    expect(within(dialog).queryByRole("group", { name: "Mode" })).not.toBeInTheDocument()
    expect(
      within(dialog).getByRole("textbox", { name: "Instructions" }).closest('[data-component="field"]'),
    ).toHaveAttribute("data-slot", "workspace-create-instructions")
    expect(within(dialog).getByRole("button", { name: "Create subagent" })).toBeDisabled()

    await userEvent.type(name, "Preview agent{Enter}")
    expect(agentCreate).toHaveBeenCalledOnce()
    expect(agentCreate).toHaveBeenCalledWith({
      workspace: workspace.id,
      id: Agent.ID.make("preview-agent"),
      name: Agent.Name.make("Preview agent"),
      instructions: "",
      mode: "subagent",
      hidden: false,
      steps: null,
      permissions: [],
    })
    expect(await screen.findByText("Subagent Preview agent created")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Create subagent" })).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
    expect(await screen.findByRole("button", { name: "Open Reviewer details" })).toBeInTheDocument()

    await userEvent.click(trigger)
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Create subagent" })).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it("loads Skills, opens their details, and reuses the fresh result when returning to the view", async () => {
    const response = Promise.withResolvers<SkillListOutput>()
    const skills = vi.fn<ByMorningClient["skill"]["list"]>(() => response.promise)
    mount(clientWith({ skills }))

    await userEvent.click(screen.getByRole("button", { name: "Skills" }))
    expect(within(document.querySelector('[data-component="home-skills"]')!).getByRole("status")).toHaveTextContent(
      "Loading skills",
    )
    expect(skills).toHaveBeenCalledWith({ workspace: workspace.id }, { signal: expect.any(AbortSignal) })

    response.resolve([skill])
    expect(screen.queryByText("Available skills")).not.toBeInTheDocument()
    const row = await screen.findByRole("button", { name: "Open Review details" })
    await userEvent.click(row)
    expect(screen.getByRole("dialog", { name: "Review" })).toHaveTextContent("Review carefully")
    expect(screen.getByRole("dialog", { name: "Review" })).toHaveTextContent("Check every change.")

    await userEvent.click(screen.getByRole("button", { name: "Close" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review" })).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole("button", { name: "Overview" }))
    await userEvent.click(screen.getByRole("button", { name: "Skills" }))
    expect(skills).toHaveBeenCalledTimes(1)
  })

  it("hides internal core Skills from the workspace list", async () => {
    const internal = {
      id: Skill.ID.make("bymorning"),
      name: "Bymorning",
      description: "Author Integrations, Plugins, Agents, Skills, and Tools.",
      instructions: "Use when authoring ByMorning extensions.",
    }
    mount(clientWith({ skills: vi.fn().mockResolvedValue([internal, skill]) }), "/skills")

    expect(await screen.findByRole("button", { name: "Open Review details" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Open Bymorning details" })).not.toBeInTheDocument()
  })

  it("shows the Skills empty state when only internal Skills exist", async () => {
    mount(
      clientWith({
        skills: vi.fn().mockResolvedValue([
          {
            id: Skill.ID.make("bymorning"),
            name: "Bymorning",
            description: "Author Integrations, Plugins, Agents, Skills, and Tools.",
            instructions: "Use when authoring ByMorning extensions.",
          },
        ]),
      }),
      "/skills",
    )

    expect(await screen.findByText("No custom skills yet.")).toBeVisible()
  })

  it("shows failed Skill requests and retries them", async () => {
    const firstRequest = Promise.withResolvers<SkillListOutput>()
    const skills = vi
      .fn<ByMorningClient["skill"]["list"]>()
      .mockImplementationOnce(() => firstRequest.promise)
      .mockResolvedValueOnce([skill])
    mount(clientWith({ skills }))

    await userEvent.click(screen.getByRole("button", { name: "Skills" }))
    expect(within(document.querySelector('[data-component="home-skills"]')!).getByRole("status")).toHaveTextContent(
      "Loading skills",
    )
    firstRequest.reject(new Error("Skills unavailable"))

    expect(await screen.findByRole("alert")).toHaveTextContent("Skills unavailable")
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByRole("button", { name: "Open Review details" })).toBeInTheDocument()
    expect(skills).toHaveBeenCalledTimes(2)
  })

  it("creates a Skill from the creation form without an ID field", async () => {
    const skillCreate = vi.fn<ByMorningClient["skill"]["create"]>().mockResolvedValue(skill)
    mount(clientWith({ skills: vi.fn().mockResolvedValue([skill]), skillCreate }), "/skills")
    const trigger = screen.getByRole("button", { name: "Add skill" })

    await userEvent.click(trigger)
    const dialog = screen.getByRole("dialog", { name: "Create skill" })
    const name = within(dialog).getByRole("textbox", { name: "Name" })
    expect(name).toHaveFocus()
    expect(name).toBeRequired()
    expect(within(dialog).getByRole("textbox", { name: "Description" })).toBeInTheDocument()
    expect(within(dialog).getByRole("textbox", { name: "Instructions" })).toBeInTheDocument()
    expect(within(dialog).queryByRole("textbox", { name: "ID" })).not.toBeInTheDocument()
    expect(
      within(dialog).getByRole("textbox", { name: "Instructions" }).closest('[data-component="field"]'),
    ).toHaveAttribute("data-slot", "workspace-create-instructions")
    expect(dialog).not.toHaveTextContent("Submitting creates the skill")
    expect(within(dialog).getByRole("button", { name: "Create skill" })).toBeDisabled()
    await userEvent.type(name, "Preview skill{Enter}")
    expect(skillCreate).toHaveBeenCalledOnce()
    expect(skillCreate).toHaveBeenCalledWith({
      workspace: workspace.id,
      name: "Preview skill",
      description: "",
      instructions: "",
    })
    expect(await screen.findByText("Skill Preview skill created")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Create skill" })).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
    expect(await screen.findByRole("button", { name: "Open Review details" })).toBeInTheDocument()
  })

  it("adds a suggested Skill from the library and refreshes the list", async () => {
    const skillCreate = vi.fn<ByMorningClient["skill"]["create"]>().mockResolvedValue(skill)
    const skills = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([skill])
    mount(clientWith({ skills, skillCreate }), "/skills")

    await userEvent.click(screen.getByRole("button", { name: "Skill library" }))
    const dialog = screen.getByRole("dialog", { name: "Skill library" })
    const entry = skillLibrary[0]!
    const item = (await within(dialog).findByText(entry.name)).closest('[data-slot="skill-library-item"]')!
    await userEvent.click(within(item as HTMLElement).getByRole("button", { name: `Add ${entry.name}` }))

    expect(skillCreate).toHaveBeenCalledWith({
      workspace: workspace.id,
      name: entry.name,
      description: entry.description,
      instructions: entry.instructions,
    })
    expect(await within(item as HTMLElement).findByText("Added")).toBeInTheDocument()
    expect(await screen.findByText(`Skill ${entry.name} added`)).toBeInTheDocument()
    expect(skills).toHaveBeenCalledTimes(2)
  })

  it("edits a Skill in place and returns to reading it after saving", async () => {
    const skillUpdate = vi.fn<ByMorningClient["skill"]["update"]>().mockResolvedValue({ ...skill, name: "Review v2" })
    mount(clientWith({ skills: vi.fn().mockResolvedValue([skill]), skillUpdate }), "/skills")

    await userEvent.click(await screen.findByRole("button", { name: "Open Review details" }))
    const detail = screen.getByRole("dialog", { name: "Review" })
    expect(detail).toHaveTextContent("Review code")
    await userEvent.click(within(detail).getByRole("button", { name: "Edit skill" }))

    const editor = await screen.findByRole("dialog", { name: "Edit skill" })
    expect(screen.queryByRole("dialog", { name: "Review" })).not.toBeInTheDocument()
    const name = within(editor).getByRole("textbox", { name: "Name" })
    expect(name).toHaveValue("Review")
    expect(within(editor).getByRole("textbox", { name: "Description" })).toHaveValue("Review code")
    expect(within(editor).getByRole("textbox", { name: "Instructions" })).toHaveValue(skill.instructions)

    await userEvent.type(name, " draft")
    await userEvent.click(within(editor).getByRole("button", { name: "Cancel" }))
    expect(await screen.findByRole("dialog", { name: "Review" })).toBeInTheDocument()
    expect(skillUpdate).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole("button", { name: "Edit skill" }))
    const reopened = within(await screen.findByRole("dialog", { name: "Edit skill" })).getByRole("textbox", {
      name: "Name",
    })
    expect(reopened).toHaveValue("Review")
    await userEvent.clear(reopened)
    await userEvent.type(reopened, "Review v2")
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }))

    expect(skillUpdate).toHaveBeenCalledWith({
      workspace: workspace.id,
      skillID: skill.id,
      name: "Review v2",
      description: "Review code",
      instructions: skill.instructions,
    })
    expect(await screen.findByRole("dialog", { name: "Review v2" })).toHaveTextContent("Review carefully")
    expect(await screen.findByText("Skill Review v2 saved")).toBeInTheDocument()
  })

  it("deletes a Skill after confirmation", async () => {
    const skillDelete = vi.fn<ByMorningClient["skill"]["delete"]>().mockResolvedValue(undefined)
    mount(clientWith({ skills: vi.fn().mockResolvedValue([skill]), skillDelete }), "/skills")

    await userEvent.click(await screen.findByRole("button", { name: "Open Review details" }))
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Review" })).getByRole("button", { name: "Delete skill" }),
    )

    const confirm = await screen.findByRole("dialog", { name: "Delete Review?" })
    await userEvent.click(within(confirm).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Delete Review?" })).not.toBeInTheDocument())
    expect(await screen.findByRole("dialog", { name: "Review" })).toBeInTheDocument()
    expect(skillDelete).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole("button", { name: "Delete skill" }))
    await userEvent.click(
      within(await screen.findByRole("dialog", { name: "Delete Review?" })).getByRole("button", {
        name: "Delete skill",
      }),
    )

    expect(skillDelete).toHaveBeenCalledWith({ workspace: workspace.id, skillID: skill.id })
    expect(await screen.findByText("Skill Review deleted")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("shows the Overview session list scoped to the selected Project", async () => {
    const projectFiles = vi.fn().mockResolvedValue({ paths: ["src/main.ts"] })
    const mounted = mount(
      clientWith({
        projectFiles,
        sessions: vi.fn().mockResolvedValue({
          data: [
            session("11111111-0000-4000-8000-000000000001", first.id),
            session("22222222-0000-4000-8000-000000000002", second.id),
          ],
        }),
      }),
      `/prj/${second.id}`,
    )

    expect(await screen.findByRole("heading", { name: "Second", level: 1 })).toBeInTheDocument()
    const region = screen.getByRole("navigation", { name: "Sessions" })
    expect(within(region).getByText("Session 22222222")).toBeInTheDocument()
    expect(within(region).queryByText("Session 11111111")).not.toBeInTheDocument()
    expect(projectFiles).not.toHaveBeenCalled()

    await userEvent.click(within(region).getByRole("link", { name: /Session 22222222/ }))
    expect(mounted.history.get()).toBe(`/w/${workspace.id}/session/22222222-0000-4000-8000-000000000002`)
  })

  it("rejects malformed and confirmed-missing Project IDs without requesting files", async () => {
    const projectFiles = vi.fn().mockResolvedValue({ paths: [] })
    const malformed = mount(clientWith({ projectFiles }), "/prj/not-a-project")
    expect(screen.getByRole("heading", { name: "Invalid project" })).toBeInTheDocument()
    malformed.unmount()

    mount(clientWith({ projectFiles }), `/prj/${Project.ID.create()}`)
    expect(await screen.findByRole("heading", { name: "Project not found" })).toBeInTheDocument()
    expect(projectFiles).not.toHaveBeenCalled()
  })

  it("reacts to Project URL changes and re-scopes the session list", async () => {
    const mounted = mount(
      clientWith({
        sessions: vi.fn().mockResolvedValue({
          data: [
            session("11111111-0000-4000-8000-000000000001", first.id),
            session("22222222-0000-4000-8000-000000000002", second.id),
          ],
        }),
      }),
      `/prj/${first.id}`,
    )
    expect(await screen.findByText("Session 11111111")).toBeInTheDocument()
    expect(screen.queryByText("Session 22222222")).not.toBeInTheDocument()

    mounted.history.set({ value: `/w/${workspace.id}/prj/${second.id}` })
    expect(await screen.findByText("Session 22222222")).toBeInTheDocument()
    expect(screen.queryByText("Session 11111111")).not.toBeInTheDocument()
  })

  it("replace-redirects legacy Files to the first confirmed Project and zero Projects to Overview", async () => {
    const populated = mount(clientWith(), "/files")
    await waitFor(() => expect(populated.history.get()).toBe(`/w/${workspace.id}/prj/${first.id}`))
    populated.unmount()

    const empty = mount(clientWith({ projects: vi.fn().mockResolvedValue([]) }), "/projects")
    await waitFor(() => expect(empty.history.get()).toBe(`/w/${workspace.id}`))
  })

  it("keeps Project inventory failure distinct from not found and offers retry", async () => {
    mount(clientWith({ projects: vi.fn().mockRejectedValue(new Error("offline")) }), `/prj/${first.id}`)
    expect(await screen.findByRole("heading", { name: "Project unavailable" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
    expect(screen.queryByText("Project not found")).not.toBeInTheDocument()
  })

  it("creates from the compact Projects action and opens the created Project route", async () => {
    const created = Project.Info.make({ id: Project.ID.create(), name: "Created", time_created: 3, time_updated: 3 })
    const createProject = vi.fn().mockResolvedValue(created)
    const mounted = mount(clientWith({ createProject }))
    const projects = screen.getByRole("button", { name: "Projects" })
    const trigger = await screen.findByRole("button", { name: "Create project" })
    await waitFor(() => expect(trigger).toBeEnabled())

    await userEvent.click(projects)
    expect(projects).toHaveAttribute("aria-expanded", "false")
    trigger.focus()
    expect(trigger).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    expect(projects).toHaveAttribute("aria-expanded", "false")
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Created")
    await userEvent.click(screen.getByRole("button", { name: "Create project" }))

    await waitFor(() => expect(mounted.history.get()).toBe(`/w/${workspace.id}/prj/${created.id}`))
    expect(createProject).toHaveBeenCalledWith(
      { name: "Created", workspace: workspace.id },
      { signal: expect.any(AbortSignal) },
    )
  })

  it("edits a Project through the SDK and refreshes the shared inventory projection", async () => {
    const updated = { ...first, name: "Renamed", time_updated: 9 }
    const updateProject = vi.fn().mockResolvedValue(updated)
    const projects = vi
      .fn<ByMorningClient["project"]["list"]>()
      .mockResolvedValueOnce(fresh([first, second]))
      .mockResolvedValueOnce(fresh([updated, second]))
    mount(clientWith({ projects, updateProject }), `/prj/${first.id}`)

    await userEvent.click(await screen.findByRole("button", { name: "Edit project" }))
    await userEvent.clear(screen.getByRole("textbox", { name: "Name" }))
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Renamed")
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() =>
      expect(updateProject).toHaveBeenCalledWith({ projectID: first.id, name: "Renamed", workspace: workspace.id }),
    )
    await waitFor(() => expect(projects).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole("heading", { name: "Renamed" })).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Close" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit project" })).not.toBeInTheDocument())
  })

  it("starts a new session in the routed Project", async () => {
    const mounted = mount(clientWith(), `/prj/${second.id}`)
    const create = await screen.findByRole("button", { name: "New session" })
    await waitFor(() => expect(create).toBeEnabled())

    await userEvent.click(create)
    expect(mounted.projectController().selection.project()?.id).toBe(second.id)
    await waitFor(() => expect(mounted.history.get()).toContain(`/w/${workspace.id}/new-session?draftId=`))
  })

  it("searches only sessions in the routed Project", async () => {
    const mounted = mount(
      clientWith({
        sessions: vi.fn().mockResolvedValue({
          data: [
            session("11111111-0000-4000-8000-000000000001", first.id),
            session("22222222-0000-4000-8000-000000000002", second.id),
          ],
        }),
      }),
      `/prj/${first.id}`,
    )
    await screen.findByText("Session 11111111")

    mounted
      .command()
      .options()
      .find((item) => item.id === "project.sessions.search.focus")
      ?.onSelect?.()
    const search = screen.getByRole("searchbox", { name: "Search First sessions" })
    expect(search).toHaveFocus()
    await userEvent.type(search, "22222222")
    expect(screen.getByText("No sessions found for “22222222”")).toBeInTheDocument()
  })

  it("does not load the Project directory for the session page", async () => {
    storage.setItem(
      `bymorning.workspace:${workspace.id}:project:${second.id}:files`,
      JSON.stringify({ version: 1, paths: ["cached.ts"] }),
    )
    const projectFiles = vi.fn().mockResolvedValue({ paths: ["fresh.ts"] })
    mount(clientWith({ projectFiles }), `/prj/${second.id}`)

    expect(await screen.findByRole("navigation", { name: "Sessions" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "cached.ts" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "fresh.ts" })).not.toBeInTheDocument()
    expect(projectFiles).not.toHaveBeenCalled()
  })

  it("navigates between route-backed workspace pages while Overview retains Sessions", async () => {
    const list = vi.fn().mockResolvedValue(fresh([first, second]))
    const mounted = mount(clientWith({ projects: list }))

    const sidebar = screen.getByRole("navigation", { name: "Workspace navigation" })
    expect(within(sidebar).getByRole("button", { name: "Overview" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("navigation", { name: "Sessions" })).toBeInTheDocument()
    expect(document.querySelector('[data-component="home-agents"]')).not.toBeInTheDocument()
    expect(document.querySelector('[data-component="home-skills"]')).not.toBeInTheDocument()
    expect(document.querySelector('[data-component="home-project-files"]')).not.toBeInTheDocument()

    await userEvent.click(within(sidebar).getByRole("button", { name: "Agents" }))
    expect(mounted.dismissals()).toBe(1)
    expect(screen.getByRole("heading", { name: "Agents" })).toBeInTheDocument()
    expect(screen.getByTestId("location")).toHaveTextContent(`/w/${workspace.id}/agents`)
    expect(screen.queryByRole("navigation", { name: "Sessions" })).not.toBeInTheDocument()
    expect(document.querySelector('[data-component="home-skills"]')).not.toBeInTheDocument()
    expect(document.querySelector('[data-component="home-project-files"]')).not.toBeInTheDocument()

    await userEvent.click(within(sidebar).getByRole("button", { name: "Skills" }))
    expect(screen.getByRole("heading", { name: "Skills" })).toBeInTheDocument()
    expect(screen.queryByRole("navigation", { name: "Sessions" })).not.toBeInTheDocument()
    expect(document.querySelector('[data-component="home-agents"]')).not.toBeInTheDocument()
    expect(document.querySelector('[data-component="home-project-files"]')).not.toBeInTheDocument()

    await userEvent.click(await within(sidebar).findByRole("link", { name: "Project settings for First" }))
    expect(screen.getByRole("navigation", { name: "Sessions" })).toBeInTheDocument()
    expect(document.querySelector('[data-component="home-agents"]')).not.toBeInTheDocument()
    expect(document.querySelector('[data-component="home-skills"]')).not.toBeInTheDocument()
    expect(document.querySelector('[data-component="home-project-files"]')).not.toBeInTheDocument()
  })

  it("mounts a trailing-slash workspace feature route directly with one active sidebar item", async () => {
    mount(clientWith({ skills: vi.fn().mockResolvedValue([skill]) }), "/skills/")

    expect(screen.getByRole("heading", { name: "Skills" })).toBeInTheDocument()
    expect(await screen.findByRole("button", { name: "Open Review details" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Skills" })).toHaveAttribute("aria-current", "page")
    expect(screen.getAllByRole("button", { current: "page" })).toHaveLength(1)
  })

  it("marks only Overview active at a trailing-slash workspace root", () => {
    mount(clientWith(), "/")

    expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-current", "page")
    expect(screen.getAllByRole("button", { current: "page" })).toHaveLength(1)
  })

  it("shows all Sessions by default, scopes by Project, and creates a draft from the selection", async () => {
    const create = vi.fn().mockResolvedValue(session("33333333-0000-4000-8000-000000000003", second.id))
    const mounted = mount(
      clientWith({
        sessions: vi.fn().mockResolvedValue({
          data: [
            session("11111111-0000-4000-8000-000000000001", first.id),
            session("22222222-0000-4000-8000-000000000002", second.id),
          ],
        }),
        createSession: create,
      }),
    )

    expect(await screen.findByText("Session 11111111")).toBeInTheDocument()
    expect(screen.getByText("Session 22222222")).toBeInTheDocument()
    mounted.projectController().selection.select(second.id)
    expect(await screen.findByText("Session 22222222")).toBeInTheDocument()
    expect(screen.queryByText("Session 11111111")).not.toBeInTheDocument()

    await waitFor(() => expect(mounted.projectController().project.confirmed()).toBe(true))

    mounted
      .command()
      .options()
      .find((item) => item.id === "session.new")
      ?.onSelect?.()
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/new-session"))
    expect(create).not.toHaveBeenCalled()
    mounted.unmount()
  })

  it("collapses Projects and expands a project's sessions from the sidebar, including by keyboard", async () => {
    mount(
      clientWith({
        sessions: vi.fn().mockResolvedValue({ data: [session("11111111-0000-4000-8000-000000000001", first.id)] }),
      }),
    )
    const sidebar = screen.getByRole("navigation", { name: "Workspace navigation" })
    const projects = within(sidebar).getByRole("button", { name: "Projects" })
    expect(projects).toHaveAttribute("aria-expanded", "true")
    await userEvent.click(projects)
    expect(projects).toHaveAttribute("aria-expanded", "false")
    await userEvent.click(projects)
    const disclosure = await within(sidebar).findByRole("button", { name: "Expand sessions for First" })

    expect(disclosure).toHaveAttribute("aria-expanded", "false")
    expect(disclosure).toHaveAttribute("aria-controls")
    const projectsLink = within(sidebar).getByRole("link", { name: "Project settings for First" })
    expect(projectsLink).toHaveAttribute("href", `/w/${workspace.id}/prj/${first.id}`)

    disclosure.focus()
    await userEvent.keyboard(" ")
    const collapse = within(sidebar).getByRole("button", { name: "Collapse sessions for First" })
    expect(collapse).toHaveAttribute("aria-expanded", "true")
    const sessions = document.getElementById(collapse.getAttribute("aria-controls")!)!
    expect(within(sessions).getByRole("link", { name: /Session 11111111/ })).toBeInTheDocument()

    await userEvent.keyboard("{Enter}")
    expect(within(sidebar).getByRole("button", { name: "Expand sessions for First" })).toHaveAttribute(
      "aria-expanded",
      "false",
    )
  })

  it("keeps the opened Session active under its Project parent", async () => {
    const firstSession = session("11111111-0000-4000-8000-000000000001", first.id)
    const secondSession = session("22222222-0000-4000-8000-000000000002", first.id)
    mount(
      clientWith({
        sessions: vi.fn().mockResolvedValue({ data: [firstSession, secondSession] }),
      }),
    )
    const sidebar = screen.getByRole("navigation", { name: "Workspace navigation" })
    await userEvent.click(await within(sidebar).findByRole("button", { name: "Expand sessions for First" }))
    await userEvent.click(await within(sidebar).findByRole("link", { name: /Session 11111111/ }))

    const current = within(sidebar).getByRole("link", { name: /Session 11111111/ })
    expect(current).toHaveAttribute("aria-current", "page")
    expect(current).toHaveAttribute("data-current")
    expect(within(sidebar).getByRole("link", { name: /Session 22222222/ })).not.toHaveAttribute("aria-current")
    expect(
      within(sidebar)
        .getByRole("button", { name: "Collapse sessions for First" })
        .closest("[data-slot='sidebar-project']"),
    ).not.toHaveAttribute("data-current")
    expect(screen.getByTestId("location")).toHaveTextContent(`/w/${workspace.id}/session/${firstSession.id}`)
  })

  it("confirms archiving the open Session with an Undo and leaves it for Overview", async () => {
    const open = session("11111111-0000-4000-8000-000000000001", first.id)
    const update = vi
      .fn<ByMorningClient["session"]["update"]>()
      .mockImplementation(async (input) => ({ ...open, ...(input.archived ? { archivedAt: new Date() } : {}) }))
    mount(
      clientWith({ sessions: vi.fn().mockResolvedValue({ data: [open] }), updateSession: update }),
      `/session/${open.id}`,
    )
    const sidebar = screen.getByRole("navigation", { name: "Workspace navigation" })
    expect(await within(sidebar).findByRole("link", { name: /Session 11111111/ })).toHaveAttribute(
      "aria-current",
      "page",
    )
    await userEvent.click(within(sidebar).getByRole("button", { name: "Session actions" }))
    await userEvent.click(
      screen.getAllByRole("menuitem", { hidden: true }).find((element) => element.textContent === "Archive session")!,
    )

    const confirm = await screen.findByRole("dialog", { name: "Archive session?" })
    expect(update).not.toHaveBeenCalled()
    expect(within(confirm).getByText(/will be hidden from session lists/)).toBeInTheDocument()
    await userEvent.click(within(confirm).getByRole("button", { name: "Archive session" }))

    await waitFor(() => expect(update).toHaveBeenCalledWith({ sessionID: open.id, archived: true }))
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(`/w/${workspace.id}`))
    expect(screen.getByTestId("location")).not.toHaveTextContent("/session/")
    expect(await screen.findByText("Session archived")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Archive session?" })).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole("button", { name: "Undo" }))
    await waitFor(() => expect(update).toHaveBeenLastCalledWith({ sessionID: open.id, archived: false }))
  })

  it("lists a project's archived Sessions, restores one, and starts from Active again", async () => {
    const active = session("11111111-0000-4000-8000-000000000001", first.id)
    const archived = { ...session("22222222-0000-4000-8000-000000000002", first.id), archivedAt: new Date(1) }
    const other = { ...session("33333333-0000-4000-8000-000000000003", second.id), archivedAt: new Date(1) }
    const list = vi.fn<ByMorningClient["session"]["list"]>().mockImplementation(async (input) => ({
      data: input?.archived ? [archived, other] : [active],
    }))
    const update = vi
      .fn<ByMorningClient["session"]["update"]>()
      .mockImplementation(async () => session("22222222-0000-4000-8000-000000000002", first.id))
    const mounted = mount(clientWith({ sessions: list, updateSession: update }), `/prj/${first.id}`)
    expect(await screen.findByText("Session 11111111")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Archived" }))
    const archivedList = await screen.findByRole("navigation", { name: "Archived" })
    expect(await within(archivedList).findByText("Session 22222222")).toBeInTheDocument()
    expect(within(archivedList).queryByText("Session 33333333")).not.toBeInTheDocument()
    expect(within(archivedList).queryByText("Session 11111111")).not.toBeInTheDocument()
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ archived: true }), expect.anything())

    await userEvent.click(within(archivedList).getByRole("button", { name: "Restore session: Session 22222222" }))
    await waitFor(() => expect(update).toHaveBeenCalledWith({ sessionID: archived.id, archived: false }))

    mounted.history.set({ value: `/w/${workspace.id}` })
    expect(await screen.findByRole("navigation", { name: "Sessions" })).toBeInTheDocument()
    expect(screen.queryByRole("navigation", { name: "Archived" })).not.toBeInTheDocument()
  })

  it("searches sessions with the existing command and opens the active result", async () => {
    const mounted = mount(
      clientWith({
        sessions: vi.fn().mockResolvedValue({
          data: [
            session("11111111-0000-4000-8000-000000000001", first.id),
            session("22222222-0000-4000-8000-000000000002", second.id),
          ],
        }),
      }),
    )
    await screen.findByText("Session 11111111")
    const sessions = screen.getByRole("navigation", { name: "Sessions" })
    expect(within(sessions).queryByRole("heading", { name: "Sessions" })).not.toBeInTheDocument()
    expect(within(sessions).queryByText("Continue your latest work across projects.")).not.toBeInTheDocument()
    expect(within(sessions).queryByText("2 sessions")).not.toBeInTheDocument()

    mounted
      .command()
      .options()
      .find((item) => item.id === "home.sessions.search.focus")
      ?.onSelect?.()
    const search = screen.getByRole("searchbox", { name: "Search sessions" })
    expect(search).toHaveFocus()
    await userEvent.type(search, "22222222")
    const results = screen.getByRole("listbox")
    expect(within(results).getByRole("option", { name: /Session 22222222/ })).toBeInTheDocument()
    expect(within(results).queryByRole("option", { name: /Session 11111111/ })).not.toBeInTheDocument()

    await userEvent.keyboard("{Enter}")
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("treats Session loading failures as a silent best-effort empty result", async () => {
    const sessions = vi.fn().mockRejectedValue(new Error("sessions offline"))
    const mounted = mount(clientWith({ projects: vi.fn().mockResolvedValue([]), sessions }))

    expect(await screen.findByText("Nothing here yet")).toBeInTheDocument()
    expect(screen.queryByText(/sessions offline/i)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Retry sessions" })).not.toBeInTheDocument()
    const sidebar = document.querySelector<HTMLButtonElement>('[data-kind="new-session"]')
    expect(sidebar).toBeDisabled()
    await waitFor(() => expect(sidebar).toHaveAttribute("title", "Workspace is unavailable"))
    expect(sidebar).toHaveAttribute("aria-description", "Workspace is unavailable")
    mounted.unmount()
  })

  it("keeps the loading reason on disabled controls without adding it to Overview", async () => {
    const projects = Promise.withResolvers<Project.Info[]>()
    const mounted = mount(clientWith({ projects: vi.fn(() => projects.promise) }))
    const header = document.querySelector<HTMLButtonElement>('[data-action="home-new-session"]')
    const sidebar = document.querySelector<HTMLButtonElement>('[data-kind="new-session"]')

    await waitFor(() => expect(header).toHaveAttribute("title", "Workspace is still loading"))
    expect(header).toBeDisabled()
    expect(header).toHaveAttribute("aria-description", "Workspace is still loading")
    expect(sidebar).toBeDisabled()
    expect(sidebar).toHaveAttribute("title", "Workspace is still loading")
    expect(sidebar).toHaveAttribute("aria-description", "Workspace is still loading")
    expect(screen.queryByText("Workspace is still loading")).not.toBeInTheDocument()

    projects.resolve(fresh([first, second]))
    await waitFor(() => expect(header).toBeEnabled())
    expect(sidebar).toBeEnabled()
    expect(header).not.toHaveAttribute("title")
    expect(header).not.toHaveAttribute("aria-description")
    expect(sidebar).not.toHaveAttribute("title")
    expect(sidebar).not.toHaveAttribute("aria-description")
    mounted.unmount()
  })

  it("explains why New session stays disabled when no Project exists", async () => {
    const mounted = mount(clientWith({ projects: vi.fn().mockResolvedValue([]) }))
    const header = document.querySelector<HTMLButtonElement>('[data-action="home-new-session"]')
    const sidebar = document.querySelector<HTMLButtonElement>('[data-kind="new-session"]')

    await waitFor(() => expect(header).toHaveAttribute("title", "Create a project first"))
    expect(header).toBeDisabled()
    expect(header).toHaveAttribute("aria-description", "Create a project first")
    expect(sidebar).toBeDisabled()
    expect(sidebar).toHaveAttribute("title", "Create a project first")
    expect(sidebar).toHaveAttribute("aria-description", "Create a project first")
    expect(await screen.findByText("Create a project first")).toBeInTheDocument()
    mounted.unmount()
  })
})
