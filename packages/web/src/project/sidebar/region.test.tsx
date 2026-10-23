import { Project } from "@bymorning/schema/project"
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { createSignal } from "solid-js"
import { afterEach, expect, it } from "vitest"

import type { ProjectModel } from "../model"
import { ProjectSidebarRegion } from "./region"
import {
  gatewayRoutes,
  consoleSidebar,
  workspaceRoutes,
  workspaceSidebarRoutes,
  type ConsoleSidebarItemID,
  type WorkspaceRouteID,
} from "./navigation"
import { normalizePathname, workspaceRouteHref } from "../../workspace-route-paths"

const first = Project.Info.make({ id: Project.ID.create(), name: "First", time_created: 1, time_updated: 1 })

afterEach(() => {
  cleanup()
  localStorage.clear()
})

it.each(["agents", "skills", "members"] satisfies ReadonlyArray<WorkspaceRouteID>)(
  "keeps %s routable but omits it from the project sidebar",
  (routeID) => {
    expect(workspaceRoutes.some((route) => route.id === routeID)).toBe(true)
    expect(workspaceSidebarRoutes.some((route) => route.id === routeID)).toBe(false)
  },
)

it("keeps existing public destinations in the sidebar", () => {
  expect(workspaceSidebarRoutes.map((route) => route.id)).toEqual(["overview", "scheduledTasks"])
})

it("never shows a Console entry in the project sidebar main pane", async () => {
  render(() => (
    <ProjectSidebarRegion
      controller={makeController()}
      onDismiss={() => undefined}
      routes={makeRoutes()}
      gateway={{ active: false, onSelectItem: () => undefined }}
    />
  ))
  const sidebar = screen.getByRole("navigation", { name: "Workspace navigation" })

  expect(within(sidebar).queryByRole("button", { name: "Console" })).not.toBeInTheDocument()

  cleanup()

  render(() => (
    <ProjectSidebarRegion
      controller={makeController()}
      onDismiss={() => undefined}
      routes={makeRoutes()}
      gateway={{ active: true, currentItem: "models", onSelectItem: () => undefined }}
    />
  ))
  await Promise.resolve()
  expect(screen.queryAllByRole("button", { name: "Console" })).toHaveLength(0)
})

it("renders public sidebar destinations in order around Projects without a Workspace disclosure", () => {
  render(() => (
    <ProjectSidebarRegion
      controller={makeController()}
      onDismiss={() => undefined}
      routes={workspaceSidebarRoutes.map((route) => ({ ...route, active: false, onSelect: () => undefined }))}
      projects={<div data-testid="sidebar-projects-slot">Projects</div>}
      gateway={{ active: false, onSelectItem: () => undefined }}
    />
  ))

  const sidebar = screen.getByRole("navigation", { name: "Workspace navigation" })
  const overview = within(sidebar).getByRole("button", { name: "Overview" })
  const scheduledTasks = within(sidebar).getByRole("button", { name: "Scheduled tasks" })
  const projects = screen.getByTestId("sidebar-projects-slot")
  expect(overview.compareDocumentPosition(scheduledTasks) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(scheduledTasks.compareDocumentPosition(projects) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(sidebar).queryByRole("button", { name: "Workspace" })).not.toBeInTheDocument()
  expect(within(sidebar).queryByRole("button", { name: "Automations" })).not.toBeInTheDocument()
  expect(within(sidebar).queryByRole("button", { name: "Agents" })).not.toBeInTheDocument()
  expect(within(sidebar).queryByRole("button", { name: "Integrations" })).not.toBeInTheDocument()
  expect(within(sidebar).queryByRole("button", { name: "Files" })).not.toBeInTheDocument()
  expect(within(sidebar).queryByRole("button", { name: "Projects" })).not.toBeInTheDocument()
})

it("renders workspace routes flat without a Workspace disclosure", () => {
  render(() => (
    <ProjectSidebarRegion controller={makeController()} onDismiss={() => undefined} routes={makeRoutes("skills")} />
  ))
  const sidebar = screen.getByRole("navigation", { name: "Workspace navigation" })
  expect(within(sidebar).queryByRole("button", { name: "Workspace" })).not.toBeInTheDocument()
  expect(within(sidebar).getByRole("button", { name: "Skills" })).toHaveAttribute("aria-current", "page")
})

it("keeps Scheduled tasks top-level", () => {
  expect(workspaceRoutes.find((route) => route.id === "scheduledTasks")).toMatchObject({
    label: "Scheduled tasks",
    icon: "central-clock",
    path: "/scheduled-tasks",
  })
  render(() => (
    <ProjectSidebarRegion
      controller={makeController()}
      onDismiss={() => undefined}
      routes={makeRoutes("scheduledTasks")}
    />
  ))

  expect(screen.getByRole("button", { name: "Scheduled tasks" })).toHaveAttribute("aria-current", "page")
  expect(screen.queryByRole("button", { name: "Workspace" })).not.toBeInTheDocument()
})

it("notifies the owner when the Console pane returns to main", async () => {
  let returns = 0
  let dismissals = 0
  render(() => (
    <ProjectSidebarRegion
      controller={makeController()}
      onDismiss={() => dismissals++}
      onReturnToMain={() => returns++}
      gateway={{ active: true, onSelectItem: () => undefined }}
    />
  ))
  await userEvent.click(screen.getByRole("button", { name: "Back to main navigation from Console" }))
  expect(returns).toBe(1)
  // Back leaves like every other drawer item, so the phone drawer closes.
  expect(dismissals).toBe(1)
  expect(screen.getByRole("button", { name: "New Session" })).toBeInTheDocument()
})

it("reveals direct Gateway routes and dismisses only on Back", async () => {
  let dismissals = 0
  const direct = render(() => (
    <ProjectSidebarRegion
      controller={makeController()}
      onDismiss={() => dismissals++}
      gateway={{ active: true, currentItem: "plugins", onSelectItem: () => undefined }}
    />
  ))
  await userEvent.click(screen.getByRole("button", { name: "Back to main navigation from Console" }))
  expect(screen.getByRole("button", { name: "New Session" })).toBeInTheDocument()
  expect(dismissals).toBe(1)
  direct.unmount()
})

it("explains why New Session is disabled until a Project can be created into", () => {
  render(() => (
    <ProjectSidebarRegion
      controller={makeController({
        canCreate: () => false,
        createDisabled: () => "Workspace is still loading",
      })}
      onDismiss={() => undefined}
    />
  ))
  const button = screen.getByRole("button", { name: "New Session" })
  expect(button).toBeDisabled()
  expect(button).toHaveAttribute("title", "Workspace is still loading")
  expect(button).toHaveAttribute("aria-description", "Workspace is still loading")
})

it("creates sessions, composes Projects after Overview, and opens the command palette", async () => {
  let searches = 0
  let sessionCreations = 0
  let dismissals = 0
  const controller = makeController({ createSession: () => (sessionCreations++, true) })
  render(() => (
    <ProjectSidebarRegion
      controller={controller}
      onDismiss={() => dismissals++}
      searchLabel="Search sessions"
      onOpenSearch={() => searches++}
      routes={makeRoutes()}
      projects={<div data-testid="sidebar-projects-slot">Projects here</div>}
    />
  ))

  expect(screen.getByTestId("sidebar-projects-slot")).toBeTruthy()
  const sidebar = screen.getByRole("navigation", { name: "Workspace navigation" })
  const newSession = within(sidebar).getByRole("button", { name: "New Session" })
  const search = screen.getByRole("button", { name: /Search sessions/ })
  expect(newSession.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  await userEvent.click(newSession)
  expect(sessionCreations).toBe(1)
  expect(dismissals).toBe(1)
  expect(screen.queryByRole("heading", { name: "Sessions" })).not.toBeInTheDocument()
  await userEvent.click(search)
  expect(searches).toBe(1)
})

it("composes the footer and moves focus from the Console pane back to main", async () => {
  const [active, setActive] = createSignal(true)
  render(() => (
    <ProjectSidebarRegion
      controller={makeController()}
      onDismiss={() => undefined}
      footer={<div data-testid="account-footer">Account</div>}
      gateway={{
        get active() {
          return active()
        },
        onSelectItem: () => undefined,
      }}
    />
  ))

  expect(screen.getByTestId("account-footer")).toBeInTheDocument()
  const back = screen.getByRole("button", { name: "Back to main navigation from Console" })
  expect(back.querySelector("use")?.getAttribute("href")).toContain("central-arrow-left")

  await userEvent.click(back)
  expect(screen.getByRole("button", { name: "New Session" })).toHaveFocus()
  expect((document.querySelector('[data-product-pane="gateway"]') as HTMLElement & { inert: boolean }).inert).toBe(true)
  setActive(false)
  await Promise.resolve()
})

it("configures every routed Gateway destination and shows available items in order", () => {
  expect(gatewayRoutes.map((item) => [item.label, item.icon, item.path])).toEqual([
    ["Overview", "central-home", "/gateway"],
    ["Leaderboard", "central-leaderboard", "/gateway/leaderboard"],
    ["Budgets", "central-wallet", "/gateway/budgets"],
    ["Service accounts", "user-key", "/gateway/service-accounts"],
    ["Models", "central-layers-three", "/gateway/models"],
  ])
  expect(consoleSidebar.groups.map((group) => group.label)).toEqual([
    "Gateway",
    "Assistant",
    "Workspace",
    "Installation",
  ])
  expect(consoleSidebar.items.map((item) => [item.label, item.icon, item.path])).toEqual([
    ["Overview", "central-home", "/gateway"],
    ["Leaderboard", "central-leaderboard", "/gateway/leaderboard"],
    ["Models", "central-layers-three", "/gateway/models"],
    ["Routing", "central-arrow-split-right", "/policies"],
    ["Integrations", "central-plug", "/mcp"],
    ["Agents", "central-agents", "/agents"],
    ["Skills", "central-agent-skills", "/skills"],
    ["Members", "central-user-group", "/members"],
    ["Service accounts", "user-key", "/gateway/service-accounts"],
    ["SSO", "shield-key", "/security"],
    ["Audit log", "central-list-bullets", "/audit"],
    ["Installation", "central-globe", "/installation"],
    ["Installation Policy", "outline-sliders", "/installation/policy"],
    ["Budgets", "central-wallet", "/gateway/budgets"],
  ])
  expect(consoleSidebar.items.map((item) => item.label)).not.toEqual(
    expect.arrayContaining([
      "Logs",
      "Bring Your Own Key",
      "Settings",
      "Model List",
      "Leaderboards",
      "Documentation",
      "Playground",
    ]),
  )
})

it("renders Console group titles in order above their destinations", () => {
  render(() => (
    <ProjectSidebarRegion
      controller={makeController()}
      onDismiss={() => undefined}
      gateway={{ active: true, currentItem: "models", onSelectItem: () => undefined }}
    />
  ))
  const sidebar = screen.getByRole("navigation", { name: "Workspace navigation" })
  const headers = [...sidebar.querySelectorAll('[data-slot="project-sidebar-group-label"]')].map(
    (node) => node.textContent,
  )
  expect(headers).toEqual(["Gateway", "Assistant", "Workspace", "Installation"])
  const overview = within(sidebar).getByRole("button", { name: "Overview" })
  const leaderboard = within(sidebar).getByRole("button", { name: "Leaderboard" })
  const models = within(sidebar).getByRole("button", { name: "Models" })
  const policies = within(sidebar).getByRole("button", { name: "Routing" })
  const mcp = within(sidebar).getByRole("button", { name: "Integrations" })
  const agents = within(sidebar).getByRole("button", { name: "Agents" })
  const skills = within(sidebar).getByRole("button", { name: "Skills" })
  const members = within(sidebar).getByRole("button", { name: "Members" })
  expect(overview.compareDocumentPosition(leaderboard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(leaderboard.compareDocumentPosition(models) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(models.compareDocumentPosition(policies) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(policies.compareDocumentPosition(mcp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(mcp.compareDocumentPosition(agents) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(agents.compareDocumentPosition(skills) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(skills.compareDocumentPosition(members) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(models).toHaveAttribute("aria-current", "page")
})

it("builds and normalizes every Gateway deep link", () => {
  const links = gatewayRoutes.map((item) => workspaceRouteHref("workspace-1", item.path))

  expect(links).toEqual([
    "/w/workspace-1/gateway",
    "/w/workspace-1/gateway/leaderboard",
    "/w/workspace-1/gateway/budgets",
    "/w/workspace-1/gateway/service-accounts",
    "/w/workspace-1/gateway/models",
  ])
  expect(links.map((link) => normalizePathname(`${link}/`))).toEqual(links)
})

it("hydrates a routed Gateway pane without animation and keeps route state truthful", async () => {
  const [active, setActive] = createSignal(true)
  const [currentItem, setCurrentItem] = createSignal<ConsoleSidebarItemID | undefined>(undefined)
  const selections: ConsoleSidebarItemID[] = []
  let dismissals = 0
  render(() => (
    <ProjectSidebarRegion
      controller={makeController()}
      onDismiss={() => dismissals++}
      gateway={{
        get active() {
          return active()
        },
        get currentItem() {
          return currentItem()
        },
        onSelectItem: (item) => {
          selections.push(item)
          setCurrentItem(item)
        },
      }}
    />
  ))
  const sidebar = screen.getByRole("navigation", { name: "Workspace navigation" })

  expect(sidebar).not.toHaveAttribute("data-pane-transition")
  expect(screen.queryByRole("button", { name: /Quick start/i })).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Budgets" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Service accounts" })).toBeInTheDocument()
  expect(screen.queryByRole("button", { current: "page" })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Models" }))
  expect(selections).toEqual(["models"])
  expect(dismissals).toBe(1)
  expect(screen.getByRole("button", { name: "Models" })).toHaveAttribute("aria-current", "page")
  expect(sidebar).not.toHaveAttribute("data-pane-transition")

  await userEvent.click(screen.getByRole("button", { name: "Back to main navigation from Console" }))
  expect(screen.getByRole("button", { name: "New Session" })).toHaveFocus()
  expect(sidebar).toHaveAttribute("data-pane-transition", "backward")
  fireEvent.animationEnd(document.querySelector('[data-slot="project-sidebar-main"]')!)

  setActive(false)
  await Promise.resolve()
  expect(screen.queryByRole("button", { name: "Console" })).not.toBeInTheDocument()
  expect(sidebar).not.toHaveAttribute("data-pane-transition")
})

it("resets nested panes when a workspace route is selected", async () => {
  let routeOpens = 0
  const [active, setActive] = createSignal(true)
  render(() => (
    <ProjectSidebarRegion
      controller={makeController()}
      onDismiss={() => undefined}
      routes={makeRoutes(undefined, () => routeOpens++)}
      gateway={{
        get active() {
          return active()
        },
        onSelectItem: () => undefined,
      }}
    />
  ))
  const sidebar = screen.getByRole("navigation", { name: "Workspace navigation" })

  await userEvent.click(screen.getByRole("button", { name: "Back to main navigation from Console" }))
  fireEvent.animationEnd(document.querySelector('[data-slot="project-sidebar-main"]')!)
  setActive(false)
  await Promise.resolve()
  await userEvent.click(screen.getByRole("button", { name: "Overview" }))
  expect(routeOpens).toBe(1)
  expect(sidebar).not.toHaveAttribute("data-pane-transition")
})

it("renders workspace routes in order and keeps gateway destinations in the Console pane", async () => {
  render(() => (
    <ProjectSidebarRegion
      controller={makeController()}
      onDismiss={() => undefined}
      routes={makeRoutes("skills")}
      gateway={{ active: true, currentItem: "mcp-gateway", onSelectItem: () => undefined }}
    />
  ))
  const sidebar = screen.getByRole("navigation", { name: "Workspace navigation" })
  expect(within(sidebar).getAllByRole("list").length).toBeGreaterThan(0)
  expect(within(sidebar).getByRole("button", { name: "Integrations" })).toBeInTheDocument()
  expect(within(sidebar).getByRole("button", { name: "Integrations" })).toHaveAttribute("aria-current", "page")
})

it("builds a trailing-slash-neutral Members route without pane animation", async () => {
  const members = workspaceRoutes.find((route) => route.id === "members")!
  const href = workspaceRouteHref("workspace-1", members.path)
  let selections = 0
  render(() => (
    <ProjectSidebarRegion
      controller={makeController()}
      onDismiss={() => undefined}
      routes={makeRoutes("members", () => selections++)}
    />
  ))

  expect(members).toMatchObject({ label: "Members", icon: "central-user-group", path: "/members" })
  expect(normalizePathname(`${href}/`)).toBe(href)
  expect(screen.getByRole("button", { name: "Members" })).toHaveAttribute("aria-current", "page")
  await userEvent.click(screen.getByRole("button", { name: "Members" }))
  expect(selections).toBe(1)
  expect(screen.getByRole("navigation", { name: "Workspace navigation" })).not.toHaveAttribute("data-pane-transition")
})

it("marks only actual pane changes as sidebar transitions", async () => {
  let mcpOpens = 0
  const [active, setActive] = createSignal(false)
  render(() => (
    <ProjectSidebarRegion
      controller={makeController({ createSession: () => true })}
      onDismiss={() => undefined}
      routes={makeRoutes(undefined, () => mcpOpens++)}
      gateway={{
        get active() {
          return active()
        },
        onSelectItem: () => undefined,
      }}
    />
  ))
  const sidebar = screen.getByRole("navigation", { name: "Workspace navigation" })

  expect(sidebar).not.toHaveAttribute("data-pane-transition")
  await userEvent.click(screen.getByRole("button", { name: "New Session" }))
  expect(sidebar).not.toHaveAttribute("data-pane-transition")
  await userEvent.click(screen.getByRole("button", { name: "Skills" }))
  expect(mcpOpens).toBe(1)
  expect(sidebar).not.toHaveAttribute("data-pane-transition")

  setActive(true)
  await Promise.resolve()
  expect(sidebar).not.toHaveAttribute("data-pane-transition")
  await userEvent.click(screen.getByRole("button", { name: "Integrations" }))
  expect(sidebar).not.toHaveAttribute("data-pane-transition")
  await userEvent.click(screen.getByRole("button", { name: "Models" }))
  expect(sidebar).not.toHaveAttribute("data-pane-transition")
  await userEvent.click(screen.getByRole("button", { name: "Back to main navigation from Console" }))
  expect(sidebar).toHaveAttribute("data-pane-transition", "backward")
})

function makeController(
  input: {
    readonly canCreate?: () => boolean
    readonly createDisabled?: () => string | undefined
    readonly createSession?: () => boolean
  } = {},
): ProjectModel {
  return {
    selection: {
      projectID: () => undefined,
      project: () => undefined,
      select: () => undefined,
      clear: () => undefined,
    },
    project: {
      list: () => [first],
      confirmed: () => true,
      create: () => undefined,
      edit: () => undefined,
      restore: async () => first,
    },
    session: {
      target: () => first,
      canCreate: input.canCreate ?? (() => true),
      createDisabled: input.createDisabled ?? (() => undefined),
      createMessage: () => undefined,
      create: input.createSession ?? (() => true),
      createWith: () => true,
      createForProject: () => true,
    },
  }
}

function makeRoutes(active?: WorkspaceRouteID, onSelect: () => void = () => undefined) {
  return workspaceRoutes.map((route) => ({ ...route, active: route.id === active, onSelect }))
}
