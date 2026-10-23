import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library"
import { afterEach, expect, it, vi } from "vitest"

import { DialogProvider, useDialog } from "../context/dialog"
import { type CommandOption } from "../shell/commands/context"
import { CommandDialog } from "./command-dialog"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it("bridges focus, keyboard, active descendant, pointer intent, selection, and nearest scrolling", async () => {
  const select = vi.fn()
  const options: CommandOption[] = Array.from({ length: 6 }, (_, index) => ({
    id: `item-${index + 1}`,
    title: `Item ${index + 1}`,
    category: index < 2 ? "First group" : "Second group",
    onSelect: select,
  }))
  function Harness() {
    const dialog = useDialog()
    return (
      <button
        type="button"
        onClick={() =>
          dialog.show(() => (
            <CommandDialog
              label="Choose an item"
              placeholder="Search items"
              options={() => options}
              closeOnSelect={false}
            />
          ))
        }
      >
        Open
      </button>
    )
  }
  render(() => (
    <DialogProvider>
      <Harness />
    </DialogProvider>
  ))
  fireEvent.click(screen.getByRole("button", { name: "Open" }))

  const input = await screen.findByRole("combobox", { name: "Search items" })
  const rows = screen.getAllByRole("option")
  expect(rows).toHaveLength(5)
  expect(screen.getByRole("listbox", { name: "Choose an item" })).toBeInTheDocument()
  expect(screen.getByRole("group", { name: "First group" })).toBeInTheDocument()
  expect(input).toHaveAttribute("aria-controls", "command-dialog-listbox")
  expect(input).toHaveAttribute("aria-activedescendant", "command-dialog-option-item-1")
  expect(rows[0]).toHaveAttribute("aria-selected", "true")

  const scrollIntoView = vi.fn()
  rows[4]!.scrollIntoView = scrollIntoView
  fireEvent.keyDown(input, { key: "ArrowUp" })
  await new Promise(requestAnimationFrame)
  expect(input).toHaveAttribute("aria-activedescendant", "command-dialog-option-item-5")
  expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" })

  fireEvent.mouseMove(window, { clientX: 10, clientY: 10 })
  fireEvent.mouseMove(rows[1]!, { clientX: 10, clientY: 10 })
  expect(input).toHaveAttribute("aria-activedescendant", "command-dialog-option-item-5")
  fireEvent.mouseMove(rows[1]!, { clientX: 11, clientY: 10 })
  expect(input).toHaveAttribute("aria-activedescendant", "command-dialog-option-item-2")

  fireEvent.keyDown(input, { key: "Enter" })
  expect(select).toHaveBeenCalledWith("palette")
  expect(screen.getByRole("dialog", { name: "Choose an item" })).toBeInTheDocument()
})

it("renders option icons and can show the full initial catalog", async () => {
  const options: CommandOption[] = Array.from({ length: 7 }, (_, index) => ({
    id: `provider-${index + 1}`,
    title: `Provider ${index + 1}`,
    icon: <span data-testid={`provider-icon-${index + 1}`} />,
  }))
  function Harness() {
    const dialog = useDialog()
    return (
      <button
        type="button"
        onClick={() =>
          dialog.show(() => (
            <CommandDialog
              label="Add provider"
              placeholder="Search providers"
              options={() => options}
              initialLimit={null}
            />
          ))
        }
      >
        Open catalog
      </button>
    )
  }
  render(() => (
    <DialogProvider>
      <Harness />
    </DialogProvider>
  ))
  fireEvent.click(screen.getByRole("button", { name: "Open catalog" }))

  await screen.findByRole("combobox", { name: "Search providers" })
  expect(screen.getAllByRole("option")).toHaveLength(7)
  expect(screen.getByTestId("provider-icon-7")).toBeInTheDocument()
})
