import { ByMorning } from "@bymorning/client"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { MemoryRouter, Route } from "@solidjs/router"
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import type { ParentProps } from "solid-js"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { TestDataProvider as DataProvider } from "../../../context/test-data-provider"
import { DialogProvider } from "../../../context/dialog"
import { SDKProvider } from "../../../context/sdk"
import { SettingsProvider } from "../../../context/settings"
import { WorkspaceScope } from "../../../context/workspace"
import { ThemeProvider } from "../../../ui/theme"
import { WorkspaceRuntimeProvider } from "../../../context/workspace-runtime"
import { CommandProvider, useCommand } from "../context"
import { createGlobalCommands } from "./global"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  vi.stubGlobal("localStorage", storage)
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
  const client = ByMorning.make({ baseUrl: "http://localhost" })
  vi.spyOn(ByMorning, "make").mockReturnValue({
    ...client,
    project: { ...client.project, list: vi.fn().mockResolvedValue([]) },
    session: { ...client.session, list: vi.fn().mockResolvedValue({ data: [] }) },
  })
})

const storage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
}
const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Default",
  status: "active",
  role: "admin",
})

const Shell = (props: ParentProps) => (
  <WorkspaceRuntimeProvider>
    <DataProvider>{props.children}</DataProvider>
  </WorkspaceRuntimeProvider>
)

const GlobalCommands = (props: ParentProps) => {
  useCommand().register("global", createGlobalCommands())
  return <>{props.children}</>
}

it("opens one palette from the global shortcut and guards an existing dialog", () => {
  const Harness = () => (
    <Shell>
      <GlobalCommands />
    </Shell>
  )
  render(() => (
    <ThemeProvider>
      <SDKProvider>
        <SettingsProvider storage={storage}>
          <DialogProvider>
            <CommandProvider>
              <WorkspaceScope list={[workspace]} current={workspace}>
                <MemoryRouter>
                  <Route path="/" component={Harness} />
                </MemoryRouter>
              </WorkspaceScope>
            </CommandProvider>
          </DialogProvider>
        </SettingsProvider>
      </SDKProvider>
    </ThemeProvider>
  ))
  fireEvent.keyDown(window, { key: "k", ctrlKey: true })
  expect(screen.getAllByRole("dialog", { name: "Commands" })).toHaveLength(1)
  fireEvent.keyDown(window, { key: "k", ctrlKey: true })
  expect(screen.getAllByRole("dialog", { name: "Commands" })).toHaveLength(1)
})

it("toggles persisted appearance settings from the global command registry", async () => {
  const user = userEvent.setup()
  render(() => (
    <ThemeProvider>
      <SDKProvider>
        <SettingsProvider storage={storage}>
          <DialogProvider>
            <CommandProvider>
              <WorkspaceScope list={[workspace]} current={workspace}>
                <MemoryRouter>
                  <Route
                    path="/"
                    component={() => (
                      <Shell>
                        <GlobalCommands />
                      </Shell>
                    )}
                  />
                </MemoryRouter>
              </WorkspaceScope>
            </CommandProvider>
          </DialogProvider>
        </SettingsProvider>
      </SDKProvider>
    </ThemeProvider>
  ))

  fireEvent.keyDown(window, { key: "k", ctrlKey: true })
  await user.click(screen.getByRole("option", { name: "Show session usage" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  fireEvent.keyDown(window, { key: "k", ctrlKey: true })
  expect(screen.getByRole("option", { name: "Hide session usage" })).toBeInTheDocument()
  await user.click(screen.getByRole("option", { name: "Show raw Markdown" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  fireEvent.keyDown(window, { key: "k", ctrlKey: true })
  expect(screen.getByRole("option", { name: "Render Markdown" })).toBeInTheDocument()
})

it("replaces the palette with appearance pickers and restores focus after selection", async () => {
  const user = userEvent.setup()
  const Harness = () => (
    <Shell>
      <GlobalCommands>
        <button type="button">Focus</button>
      </GlobalCommands>
    </Shell>
  )
  render(() => (
    <ThemeProvider>
      <SDKProvider>
        <SettingsProvider storage={storage}>
          <DialogProvider>
            <CommandProvider>
              <WorkspaceScope list={[workspace]} current={workspace}>
                <MemoryRouter>
                  <Route path="/" component={Harness} />
                </MemoryRouter>
              </WorkspaceScope>
            </CommandProvider>
          </DialogProvider>
        </SettingsProvider>
      </SDKProvider>
    </ThemeProvider>
  ))

  const trigger = screen.getByRole("button", { name: "Focus" })
  trigger.focus()
  fireEvent.keyDown(window, { key: "k", ctrlKey: true })
  await user.type(screen.getByRole("combobox", { name: "Search commands" }), "theme")
  await user.click(screen.getByRole("option", { name: "Choose theme" }))
  expect(screen.getByRole("dialog", { name: "Choose theme" })).toBeInTheDocument()
  expect(screen.getByRole("combobox", { name: "Search themes" })).toBeInTheDocument()
  expect(screen.queryByRole("option", { name: "Default" })).not.toBeInTheDocument()
  expect(screen.getByRole("option", { name: "Sand" })).toBeInTheDocument()
  await user.click(screen.getByRole("option", { name: "Ink" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  expect(document.documentElement.dataset.theme).toBe("ink")
  expect(trigger).toHaveFocus()

  fireEvent.keyDown(window, { key: "k", ctrlKey: true })
  await user.type(screen.getByRole("combobox", { name: "Search commands" }), "color")
  await user.click(screen.getByRole("option", { name: "Choose color mode" }))
  expect(screen.getByRole("dialog", { name: "Choose color mode" })).toBeInTheDocument()
  expect(screen.getByRole("combobox", { name: "Search color modes" })).toBeInTheDocument()
  await user.click(screen.getByRole("option", { name: "Light" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  expect(document.documentElement.dataset.colorScheme).toBe("light")
  expect(trigger).toHaveFocus()
})

it("hints at session and workspace search and never preselects archiving", () => {
  const Harness = () => (
    <Shell>
      <GlobalCommands>
        <SessionCommands />
      </GlobalCommands>
    </Shell>
  )
  const SessionCommands = () => {
    useCommand().register("session.lifecycle", () => [
      { id: "session.archive", title: "Archive session", category: "Session" },
    ])
    return <></>
  }
  render(() => (
    <ThemeProvider>
      <SDKProvider>
        <SettingsProvider storage={storage}>
          <DialogProvider>
            <CommandProvider>
              <WorkspaceScope list={[workspace]} current={workspace}>
                <MemoryRouter>
                  <Route path="/" component={Harness} />
                </MemoryRouter>
              </WorkspaceScope>
            </CommandProvider>
          </DialogProvider>
        </SettingsProvider>
      </SDKProvider>
    </ThemeProvider>
  ))
  fireEvent.keyDown(window, { key: "k", ctrlKey: true })
  const input = screen.getByRole("combobox", { name: "Search commands" })
  expect(input).toHaveAttribute("placeholder", "Search commands, sessions, and workspaces")
  expect(screen.getByRole("option", { selected: true })).not.toHaveAccessibleName("Archive session")
})
