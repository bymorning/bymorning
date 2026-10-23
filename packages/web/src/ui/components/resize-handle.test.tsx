import { cleanup, fireEvent, render } from "@solidjs/testing-library"
import { createSignal } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ResizeHandle } from "./resize-handle"

afterEach(() => {
  cleanup()
  document.body.style.userSelect = ""
  document.body.style.overflow = ""
})

describe("ResizeHandle", () => {
  it("exposes a separator with the orientation of the divider", () => {
    const horizontal = render(() => (
      <ResizeHandle direction="horizontal" size={300} min={200} max={480} onResize={() => {}} />
    ))
    expect(horizontal.getByRole("separator")).toHaveAttribute("aria-orientation", "vertical")
    horizontal.unmount()
    const vertical = render(() => (
      <ResizeHandle direction="vertical" size={300} min={200} max={480} onResize={() => {}} />
    ))
    expect(vertical.getByRole("separator")).toHaveAttribute("aria-orientation", "horizontal")
  })

  it("applies start-edge movement, clamps values, and restores drag styles", () => {
    const resize = vi.fn()
    const view = render(() => (
      <ResizeHandle direction="horizontal" edge="start" size={300} min={200} max={480} onResize={resize} />
    ))
    const handle = view.container.firstElementChild!
    document.body.style.userSelect = "text"
    document.body.style.overflow = "clip"

    fireEvent.mouseDown(handle, { clientX: 500, detail: 1 })
    expect(document.body.style.userSelect).toBe("none")
    expect(document.body.style.overflow).toBe("hidden")

    fireEvent.mouseMove(document, { clientX: 400 })
    expect(resize).toHaveBeenLastCalledWith(400)
    fireEvent.mouseMove(document, { clientX: 700 })
    expect(resize).toHaveBeenLastCalledWith(200)
    fireEvent.mouseMove(document, { clientX: 200 })
    expect(resize).toHaveBeenLastCalledWith(480)

    fireEvent.mouseUp(document)
    expect(document.body.style.userSelect).toBe("text")
    expect(document.body.style.overflow).toBe("clip")
  })

  it("cleans up an active drag when unmounted", () => {
    const resize = vi.fn()
    const view = render(() => <ResizeHandle direction="horizontal" size={300} min={200} max={480} onResize={resize} />)
    fireEvent.mouseDown(view.container.firstElementChild!, { clientX: 300, detail: 1 })
    view.unmount()
    fireEvent.mouseMove(document, { clientX: 400 })

    expect(resize).not.toHaveBeenCalled()
    expect(document.body.style.userSelect).toBe("")
    expect(document.body.style.overflow).toBe("")
  })

  it("calculates every move from the width at drag start", () => {
    const [size, setSize] = createSignal(300)
    const view = render(() => (
      <ResizeHandle direction="horizontal" edge="start" size={size()} min={200} max={600} onResize={setSize} />
    ))

    fireEvent.mouseDown(view.container.firstElementChild!, { clientX: 500, detail: 1 })
    fireEvent.mouseMove(document, { clientX: 450 })
    expect(size()).toBe(350)
    fireEvent.mouseMove(document, { clientX: 400 })
    expect(size()).toBe(400)
  })
})
