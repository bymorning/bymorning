import { cleanup, render, screen } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TextAction } from "./text-action"

beforeEach(() => {
  vi.stubGlobal("DOMRect", class DOMRect {})
  Range.prototype.getBoundingClientRect = () => new DOMRect() as DOMRect
})

afterEach(() => {
  document.getSelection()?.removeAllRanges()
  cleanup()
  vi.unstubAllGlobals()
})

describe("TextAction", () => {
  it("does not offer actions while an assistant part is streaming", () => {
    const view = render(() => (
      <TextAction.Root streaming>
        <p>Partial response</p>
      </TextAction.Root>
    ))
    const text = view.container.querySelector("p")!.firstChild!
    const range = document.createRange()
    range.selectNodeContents(text)
    const selection = document.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event("selectionchange"))

    expect(view.container.querySelector('[aria-label="Selected text actions"]')).not.toBeInTheDocument()
  })

  it("offers a keyboard-accessible Copy action only for selected completed text", () => {
    const view = render(() => (
      <TextAction.Root>
        <p>Completed response</p>
      </TextAction.Root>
    ))
    const text = view.container.querySelector("p")!.firstChild!
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, "Completed".length)
    const selection = document.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event("selectionchange"))

    expect(screen.getByRole("button", { name: "Selected text actions" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Copy" })).toBeInTheDocument()
  })
})
