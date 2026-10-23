import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import userEvent from "@testing-library/user-event"
import { createStore } from "solid-js/store"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RightSidebar } from "./right-sidebar"

afterEach(cleanup)

function mount() {
  const [state, setState] = createStore({ open: true, width: 720 })
  const resize = vi.fn((width: number) => setState("width", width))
  const reset = vi.fn(() => setState("width", 720))
  let trigger!: HTMLButtonElement
  let focusOnOpen = false
  render(() => (
    <>
      <button
        ref={(element) => (trigger = element)}
        onClick={() => {
          focusOnOpen = document.activeElement === trigger
          setState("open", true)
        }}
      >
        Open sidebar
      </button>
      <RightSidebar
        open={state.open}
        size={{ width: () => state.width, min: 480, max: () => 960, full: () => 1440, resize, reset }}
        close={() => setState("open", false)}
        restoreFocus={() => trigger.focus()}
        focusOnOpen={() => focusOnOpen}
        header={<span>Inspector</span>}
      >
        <label>
          Notes
          <input />
        </label>
      </RightSidebar>
    </>
  ))
  return { resize, reset }
}

describe("RightSidebar", () => {
  it("animates toggles but not restored open state or workspace measurements", () => {
    const state = mount()
    const panel = screen.getByRole("complementary", { name: "Right sidebar" })
    expect(panel).not.toHaveAttribute("data-animating")
    state.resize(800)
    expect(panel).not.toHaveAttribute("data-animating")
    fireEvent.click(screen.getByRole("button", { name: "Close right sidebar" }))
    expect(panel).toHaveAttribute("data-animating")
    const end = new Event("transitionend", { bubbles: true })
    Object.defineProperty(end, "propertyName", { value: "width" })
    fireEvent(panel, end)
    expect(panel).not.toHaveAttribute("data-animating")
    fireEvent.click(screen.getByRole("button", { name: "Open sidebar" }))
    expect(panel).toHaveAttribute("data-animating")
    fireEvent(panel, end)
    state.resize(900)
    expect(panel).not.toHaveAttribute("data-animating")
    cleanup()
    mount()
    expect(screen.getByRole("complementary", { name: "Right sidebar" })).not.toHaveAttribute("data-animating")
  })

  it("hosts non-file content and preserves it across close/open with focus restoration", async () => {
    mount()
    const input = screen.getByRole("textbox", { name: "Notes" })
    await userEvent.setup().type(input, "Keep this draft")
    await userEvent.setup().click(screen.getByRole("button", { name: "Close right sidebar" }))
    await Promise.resolve()
    expect(screen.getByRole("button", { name: "Open sidebar" })).toHaveFocus()
    const panel = document.querySelector('[data-component="right-sidebar"]')!
    expect(panel).toHaveAttribute("aria-hidden", "true")
    expect(panel).toHaveProperty("inert", true)
    await userEvent.setup().click(screen.getByRole("button", { name: "Open sidebar" }))
    expect(screen.getByRole("textbox", { name: "Notes" })).toBe(input)
    expect(input).toHaveValue("Keep this draft")
    expect(panel).toHaveProperty("inert", false)
    expect(screen.getByText("Inspector")).toBeVisible()
  })

  it("moves focus from the opening control to the panel instead of dropping it", async () => {
    mount()
    await userEvent.setup().click(screen.getByRole("button", { name: "Close right sidebar" }))
    await Promise.resolve()
    const trigger = screen.getByRole("button", { name: "Open sidebar" })
    expect(trigger).toHaveFocus()
    trigger.focus()
    fireEvent.click(trigger)
    await Promise.resolve()
    expect(screen.getByRole("button", { name: "Close right sidebar" })).toHaveFocus()
  })

  it("resizes from the left edge, clamps width, and resets on double click", () => {
    const state = mount()
    const panel = screen.getByRole("complementary", { name: "Right sidebar" })
    const handle = panel.querySelector('[data-slot="right-sidebar-resize"]')!.firstElementChild!
    expect(panel).toHaveStyle("--right-sidebar-width: 720px")
    fireEvent.mouseDown(handle, { clientX: 500, detail: 1 })
    fireEvent.mouseMove(document, { clientX: 350 })
    expect(state.resize).toHaveBeenLastCalledWith(870)
    expect(panel).toHaveStyle("--right-sidebar-width: 870px")
    fireEvent.mouseMove(document, { clientX: 900 })
    expect(state.resize).toHaveBeenLastCalledWith(480)
    fireEvent.mouseUp(document)
    fireEvent.dblClick(handle)
    expect(state.reset).toHaveBeenCalledOnce()
    expect(panel).toHaveStyle("--right-sidebar-width: 720px")
  })

  it("expands to the session panel width and restores the previous split width", async () => {
    const state = mount()
    const panel = screen.getByRole("complementary", { name: "Right sidebar" })
    const notes = screen.getByRole("textbox", { name: "Notes" })
    const expand = screen.getByRole("button", { name: "Expand right sidebar" })
    await userEvent.setup().type(notes, "Keep this preview")
    expect(panel).not.toHaveAttribute("data-expanded")
    expect(expand).toHaveAttribute("aria-pressed", "false")
    await userEvent.setup().click(expand)
    expect(panel).toHaveAttribute("data-expanded")
    expect(panel).toHaveAttribute("data-animating")
    expect(panel).toHaveStyle("--right-sidebar-width: 1440px")
    expect(state.resize).not.toHaveBeenCalled()
    const collapse = screen.getByRole("button", { name: "Collapse right sidebar" })
    expect(collapse).toHaveAttribute("aria-pressed", "true")
    await userEvent.setup().click(collapse)
    expect(panel).not.toHaveAttribute("data-expanded")
    expect(panel).toHaveStyle("--right-sidebar-width: 720px")
    expect(screen.getByRole("button", { name: "Expand right sidebar" })).toHaveAttribute("aria-pressed", "false")
    expect(notes).toHaveValue("Keep this preview")
  })
})
