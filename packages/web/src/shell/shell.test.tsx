import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { cleanup, render, screen } from "@solidjs/testing-library"
import { createSignal } from "solid-js"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { DialogProvider } from "../context/dialog"
import { GatewayPage } from "../gateway/page"
import { SettingsProvider } from "../context/settings"
import { WorkspaceScope } from "../context/workspace"
import type { SyncStorage } from "../runtime/persistence/storage"
import { CommandProvider } from "./commands/context"
import { EmptyShell } from "./empty-shell"
import Shell from "./shell"
import { LayoutProvider } from "./state/layout"

const storage: SyncStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
}
const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Test",
  status: "active",
  role: "admin",
})

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it("renders empty sidebar and content chrome while the workspace is pending", () => {
  render(() => <EmptyShell />)

  expect(document.querySelector('[data-component="shell"]')).toHaveAttribute("aria-busy", "true")
  expect(document.querySelector('[data-slot="project-sidebar"]')).toBeEmptyDOMElement()
  expect(document.querySelector('[data-slot="shell-content"]')).toBeEmptyDOMElement()
  expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
})

it("renders only the mobile sidebar launcher ahead of route content", () => {
  render(() => (
    <SettingsProvider storage={storage}>
      <DialogProvider>
        <CommandProvider>
          <WorkspaceScope list={[workspace]} current={workspace}>
            <LayoutProvider storage={storage}>
              <Shell sidebar={() => <nav aria-label="Workspace navigation">Sidebar</nav>}>
                <h1>Overview</h1>
              </Shell>
            </LayoutProvider>
          </WorkspaceScope>
        </CommandProvider>
      </DialogProvider>
    </SettingsProvider>
  ))

  expect(document.querySelector('[data-component="shell-header"]')).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /new session/i })).not.toBeInTheDocument()
  const controls = document.querySelector('[data-slot="shell-mobile-controls"]')!
  expect(controls).toContainElement(screen.getByRole("button", { name: "Open project sidebar" }))
  expect(controls.nextElementSibling).toHaveAttribute("data-slot", "shell-route-content")
})

it("exposes contained and document route layout ownership at the shell boundary", () => {
  const [layout, setLayout] = createSignal<"contained" | "document">("contained")
  render(() => (
    <SettingsProvider storage={storage}>
      <DialogProvider>
        <CommandProvider>
          <WorkspaceScope list={[workspace]} current={workspace}>
            <LayoutProvider storage={storage}>
              <Shell layout={layout()} sidebar={() => <nav>Sidebar</nav>}>
                <GatewayPage title="Gateway" description="Gateway route">
                  Route
                </GatewayPage>
              </Shell>
            </LayoutProvider>
          </WorkspaceScope>
        </CommandProvider>
      </DialogProvider>
    </SettingsProvider>
  ))

  expect(document.querySelector('[data-component="shell"]')).toHaveAttribute("data-layout", "contained")
  expect(screen.getAllByRole("main")).toHaveLength(1)
  expect(screen.getByRole("main")).toContainElement(screen.getByRole("heading", { name: "Gateway" }))
  setLayout("document")
  expect(document.querySelector('[data-component="shell"]')).toHaveAttribute("data-layout", "document")
})
