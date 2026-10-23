import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { readFileSync } from "node:fs"
import { onMount } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"

import { WorkspaceScope } from "../../context/workspace"
import type { SyncStorage } from "../../runtime/persistence/storage"
import { LayoutProvider } from "../state/layout"
import { Sidebar } from "./sidebar"

const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Test",
  status: "active",
  role: "admin",
})

afterEach(cleanup)

it("layers the mobile drawer above route content and below dialogs", () => {
  const styles = readFileSync("src/shell/sidebar/sidebar.css", "utf8")
  expect(styles).toMatch(/\[data-slot="project-sidebar"\] \{[^}]*z-index: 40;/s)
  expect(styles).toMatch(/\[data-slot="mobile-sidebar-backdrop"\] \{[^}]*z-index: 39;/s)
  expect(styles).toMatch(/\[data-slot="shell-mobile-controls"\] \{[^}]*min-height: 52px;/s)
  expect(styles).toMatch(/\[data-slot="mobile-sidebar-toggle"\] \{[^}]*width: 44px;[^}]*height: 44px;/s)
})

it("mounts its child once and applies desktop and mobile sidebar semantics", async () => {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const query = {
    matches: false,
    media: "(max-width: 700px)",
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener),
    ),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList
  const matchMedia = vi.fn(() => query)
  const descriptor = Object.getOwnPropertyDescriptor(window, "matchMedia")
  Object.defineProperty(window, "matchMedia", { configurable: true, value: matchMedia })
  const values = new Map<string, string>()
  const storage: SyncStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  let mounts = 0
  function Child(props: { readonly onSelectRoute: () => void }) {
    onMount(() => mounts++)
    return (
      <button type="button" onClick={props.onSelectRoute}>
        Select workspace route
      </button>
    )
  }

  const view = render(() => (
    <WorkspaceScope list={[workspace]} current={workspace}>
      <LayoutProvider storage={storage}>
        <Sidebar
          render={(sidebar) => (
            <div data-component="shell">
              <div data-slot="shell-mobile-controls">{sidebar.mobileToggle}</div>
              {sidebar.frame}
              <main data-slot="shell-content" tabIndex={-1} />
            </div>
          )}
        >
          {(onDismiss) => <Child onSelectRoute={onDismiss} />}
        </Sidebar>
      </LayoutProvider>
    </WorkspaceScope>
  ))

  expect(matchMedia).toHaveBeenCalledOnce()
  expect(matchMedia).toHaveBeenCalledWith("(max-width: 700px)")
  expect(query.addEventListener).toHaveBeenCalledOnce()
  expect(mounts).toBe(1)
  expect(document.querySelectorAll("aside")).toHaveLength(1)
  const aside = document.getElementById("project-sidebar")!
  expect(aside).toHaveAttribute("aria-hidden", "false")
  expect(aside).not.toHaveAttribute("inert")

  expect(screen.queryByRole("button", { name: /(?:hide|show) project sidebar/i })).not.toBeInTheDocument()
  screen.getByRole("button", { name: "Select workspace route" }).focus()
  const handle = document.querySelector<HTMLElement>(
    '[data-slot="project-sidebar-resize"] > [data-component="resize-handle"]',
  )!
  fireEvent.mouseDown(handle, { clientX: 500, detail: 1 })
  fireEvent.mouseMove(document, { clientX: 300 })
  expect(aside).toHaveAttribute("aria-hidden", "true")
  expect((aside as HTMLElement & { inert: boolean }).inert).toBe(true)
  await Promise.resolve()
  expect(document.querySelector('[data-slot="shell-content"]')).toHaveFocus()
  const key = `bymorning.workspace:${workspace.id}:layout`
  expect(JSON.parse(values.get(key)!).sidebar.opened).toBe(false)

  fireEvent.mouseMove(document, { clientX: 850 })
  expect(aside).toHaveAttribute("aria-hidden", "false")
  expect(aside).toHaveStyle("--project-sidebar-width: 480px")
  expect(JSON.parse(values.get(key)!).sidebar).toEqual({ opened: true, width: 480 })
  fireEvent.mouseMove(document, { clientX: 400 })
  expect(aside).toHaveStyle("--project-sidebar-width: 200px")
  fireEvent.mouseUp(document)

  fireEvent.mouseDown(handle, { clientX: 500, detail: 1 })
  fireEvent.mouseMove(document, { clientX: 200 })
  fireEvent.mouseUp(document)
  expect(aside).toHaveAttribute("aria-hidden", "true")
  fireEvent.dblClick(handle)
  expect(aside).toHaveAttribute("aria-hidden", "false")
  expect(aside).toHaveStyle("--project-sidebar-width: 256px")

  Object.defineProperty(query, "matches", { configurable: true, value: true })
  listeners.forEach((listener) => listener({ matches: true } as MediaQueryListEvent))
  expect(screen.getByRole("button", { name: "Open project sidebar" })).toHaveAttribute("aria-expanded", "false")
  await userEvent.click(screen.getByRole("button", { name: "Open project sidebar" }))
  expect(aside).toHaveAttribute("aria-hidden", "false")
  expect(JSON.parse(values.get(key)!).sidebar.opened).toBe(true)
  expect(screen.getAllByRole("button", { name: "Close project sidebar" })).toHaveLength(2)
  await userEvent.click(screen.getByRole("button", { name: "Select workspace route" }))
  expect(aside).toHaveAttribute("aria-hidden", "true")
  expect(JSON.parse(values.get(key)!).sidebar.opened).toBe(true)
  expect(screen.queryAllByRole("button", { name: "Close project sidebar" })).toHaveLength(0)

  await userEvent.click(screen.getByRole("button", { name: "Open project sidebar" }))
  Object.defineProperty(query, "matches", { configurable: true, value: false })
  listeners.forEach((listener) => listener({ matches: false } as MediaQueryListEvent))
  expect(aside).toHaveAttribute("aria-hidden", "false")
  expect(screen.queryByRole("button", { name: "Show project sidebar" })).not.toBeInTheDocument()
  expect(JSON.parse(values.get(key)!).sidebar.opened).toBe(true)
  expect(mounts).toBe(1)

  view.unmount()
  expect(query.removeEventListener).toHaveBeenCalledOnce()
  if (descriptor) Object.defineProperty(window, "matchMedia", descriptor)
  else Reflect.deleteProperty(window, "matchMedia")
})
