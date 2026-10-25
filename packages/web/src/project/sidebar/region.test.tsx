import { Project } from "@bymorning/schema/project"
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { createSignal } from "solid-js"
import { afterEach, expect, it } from "vitest"

import type { ProjectModel } from "../model"
import { ProjectSidebarRegion } from "./region"
import { workspaceRoutes, type ConsoleSidebarItemID, type WorkspaceRouteID } from "./navigation"

const first = Project.Info.make({ id: Project.ID.create(), name: "First", time_created: 1, time_updated: 1 })

afterEach(() => {
  cleanup()
  localStorage.clear()
})

it("renders workspace routes flat without a Workspace disclosure", () => {
  render(() => (
    <ProjectSidebarRegion controller={makeController()} onDismiss={() => undefined} routes={makeRoutes("skills")} />
  ))
  const sidebar = screen.getByRole("navigation", { name: "Workspace navigation" })
  expect(within(sidebar).queryByRole("button", { name: "Workspace" })).not.toBeInTheDocument()
  expect(within(sidebar).getByRole("button", { name: "Skills" })).toHaveAttribute("aria-current", "page")
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

  await userEvent.click(back)
  expect(screen.getByRole("button", { name: "New Session" })).toHaveFocus()
  expect((document.querySelector('[data-product-pane="gateway"]') as HTMLElement & { inert: boolean }).inert).toBe(true)
  setActive(false)
  await Promise.resolve()
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
