import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { DialogProvider, useDialog } from "../context/dialog"
import { WorkspaceSwitcherDialog } from "./workspace-switcher-dialog"

const current = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Test Workspace",
  status: "active",
  role: "admin",
})
const second = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Production",
  status: "active",
  role: "admin",
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it("searches admitted workspaces and selects with listbox keyboard semantics", async () => {
  const select = vi.fn()
  renderDialog(select)
  await userEvent.click(screen.getByRole("button", { name: "Open switcher" }))

  const search = await screen.findByRole("combobox", { name: "Search workspaces" })
  expect(search).toHaveFocus()
  expect(screen.getByRole("listbox", { name: "Workspaces" })).toBeInTheDocument()
  expect(screen.getByRole("option", { name: /Test Workspace Current/ })).toHaveAttribute("aria-current", "true")
  expect(search).toHaveAttribute("aria-activedescendant", `workspace-switcher-option-${current.id}`)
  fireEvent.keyDown(search, { key: "ArrowDown" })
  expect(search).toHaveAttribute("aria-activedescendant", `workspace-switcher-option-${second.id}`)
  fireEvent.keyDown(search, { key: "ArrowUp" })

  await userEvent.type(search, "prod")
  expect(screen.queryByRole("option", { name: /Test Workspace/ })).not.toBeInTheDocument()
  expect(screen.getByRole("option", { name: /Production/ })).toBeInTheDocument()
  fireEvent.keyDown(search, { key: "Enter" })
  expect(select).toHaveBeenCalledOnce()
  expect(select).toHaveBeenCalledWith(second)
})

it("shows an empty result and closes current selection without navigation", async () => {
  const select = vi.fn()
  renderDialog(select)
  const trigger = screen.getByRole("button", { name: "Open switcher" })
  await userEvent.click(trigger)
  const search = await screen.findByRole("combobox", { name: "Search workspaces" })
  await userEvent.type(search, "missing")
  expect(screen.getByText("No workspaces found")).toBeInTheDocument()
  await userEvent.clear(search)
  await userEvent.click(screen.getByRole("option", { name: /Test Workspace Current/ }))
  expect(select).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Switch workspace" })).not.toBeInTheDocument())
  expect(trigger).toHaveFocus()
})

it("dismisses with Escape and restores focus to its opener", async () => {
  renderDialog(vi.fn())
  const trigger = screen.getByRole("button", { name: "Open switcher" })
  await userEvent.click(trigger)
  await screen.findByRole("dialog", { name: "Switch workspace" })
  await userEvent.keyboard("{Escape}")
  await waitFor(() => expect(trigger).toHaveFocus())

  await userEvent.click(trigger)
  await screen.findByRole("dialog", { name: "Switch workspace" })
  fireEvent.click(document.querySelector('[data-component="dialog-overlay"]')!)
  await waitFor(() => expect(trigger).toHaveFocus())
})

function renderDialog(onSelect: (workspace: typeof current) => void) {
  function Harness() {
    const dialog = useDialog()
    return (
      <button
        type="button"
        onClick={() =>
          dialog.show(() => (
            <WorkspaceSwitcherDialog workspaces={[current, second]} currentID={current.id} onSelect={onSelect} />
          ))
        }
      >
        Open switcher
      </button>
    )
  }
  render(() => (
    <DialogProvider>
      <Harness />
    </DialogProvider>
  ))
}
