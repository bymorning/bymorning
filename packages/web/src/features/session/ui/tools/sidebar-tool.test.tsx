import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SessionUI } from "../session-model"
import { ToolDisplay } from "./tool-display"

afterEach(cleanup)

describe("Sidebar tool", () => {
  it("shows a generic label before the Tool result is known", () => {
    const view = render(() => <ToolDisplay tool={sidebar({}, { type: "running" })} onFileOpen={() => {}} />)

    expect(view.container.querySelector('[data-component="tool-loaded-item"]')).toHaveTextContent("Right sidebar")
  })

  it("reports opening without naming a file", () => {
    const view = render(() => <ToolDisplay tool={sidebar({ open: true })} onFileOpen={() => {}} />)

    expect(view.container.querySelector('[data-component="tool-loaded-item"]')).toHaveTextContent(
      "Opened the right sidebar",
    )
  })

  it("reports closing", () => {
    const view = render(() => <ToolDisplay tool={sidebar({ open: false })} onFileOpen={() => {}} />)

    expect(view.container.querySelector('[data-component="tool-loaded-item"]')).toHaveTextContent(
      "Closed the right sidebar",
    )
  })

  it("shows the displayed Project File and opens it on click", () => {
    const onFileOpen = vi.fn()
    const view = render(() => (
      <ToolDisplay tool={sidebar({ open: true, path: "dashboards/status.html" })} onFileOpen={onFileOpen} />
    ))

    const row = view.container.querySelector('[data-component="tool-loaded-item"]')
    const button = view.container.querySelector('[data-slot="tool-loaded-value"]')
    expect(button).toHaveTextContent("dashboards/status.html")
    expect(row).toHaveTextContent("Showing")
    expect(row).toHaveTextContent("in the Right Sidebar")

    fireEvent.click(button!)
    expect(onFileOpen).toHaveBeenCalledWith("dashboards/status.html")
  })

  it("prefers the validated Tool result over the requested input once succeeded", () => {
    const view = render(() => (
      <ToolDisplay
        tool={sidebar(
          { open: true, path: "dashboards/status.html" },
          { type: "succeeded", result: { open: true, path: "dashboards/other.html" } },
        )}
        onFileOpen={() => {}}
      />
    ))

    const button = view.container.querySelector('[data-slot="tool-loaded-value"]')
    expect(button).toHaveTextContent("dashboards/other.html")
    expect(button).not.toHaveTextContent("dashboards/status.html")
  })

  it("shimmers the path while running", () => {
    const view = render(() => (
      <ToolDisplay
        tool={sidebar({ open: true, path: "dashboards/status.html" }, { type: "running" })}
        onFileOpen={() => {}}
      />
    ))

    expect(
      view.container.querySelector('[data-slot="tool-loaded-value"] [data-component="text-shimmer"]'),
    ).toHaveAttribute("data-active", "true")
  })
})

function sidebar(input: SessionUI.JsonRecord, state: SessionUI.ToolState = { type: "succeeded" }): SessionUI.ToolPart {
  return { type: "tool", id: "sidebar", name: "sidebar", input, metadata: {}, state }
}
