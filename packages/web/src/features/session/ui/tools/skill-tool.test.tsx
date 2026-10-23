import { cleanup, render, screen } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { afterEach, describe, expect, it } from "vitest"

import type { SessionUI } from "../session-model"
import { ToolDisplay } from "./tool-display"

afterEach(cleanup)

describe("Skill tool", () => {
  it.each([
    { metadata: { name: "Metadata" }, input: { id: "ID", name: "Input" }, expected: "Metadata" },
    { metadata: {}, input: { id: "ID", name: "Input" }, expected: "ID" },
    { metadata: {}, input: { name: "Input" }, expected: "Input" },
  ])("uses source name precedence for $expected", ({ metadata, input, expected }) => {
    const view = render(() => <ToolDisplay tool={skill(input, metadata)} onFileOpen={() => {}} />)

    expect(screen.getByLabelText(`Loaded ${expected} skill`)).toBeInTheDocument()
    expect(view.container.querySelector('[data-slot="tool-loaded-value"]')).toHaveTextContent(expected)
  })

  it("uses the loaded Skill result name for calls persisted without name metadata", () => {
    render(() => (
      <ToolDisplay
        tool={skill({ id: "bymorning" }, {}, { type: "succeeded", result: { name: "Bymorning" } })}
        onFileOpen={() => {}}
      />
    ))

    expect(screen.getByLabelText("Loaded Bymorning skill")).toBeInTheDocument()
  })

  it("shimmers only the name while running and settles it without changing the loaded row", () => {
    const running = render(() => (
      <ToolDisplay tool={skill({ id: "browser-control" }, {}, { type: "running" })} onFileOpen={() => {}} />
    ))
    const row = screen.getByLabelText("Loaded browser-control skill")

    expect(row.querySelector('[data-slot="tool-loaded-label"]')).toHaveTextContent("Loaded")
    expect(row.querySelector('[data-slot="tool-loaded-kind"]')).toHaveTextContent("skill")
    expect(row.querySelector('[data-slot="tool-loaded-value"] [data-component="text-shimmer"]')).toHaveAttribute(
      "data-active",
      "true",
    )
    expect(row.querySelector('[data-slot="tool-loaded-label"] [data-component="text-shimmer"]')).toBeNull()
    expect(row.querySelector('[data-slot="tool-loaded-kind"] [data-component="text-shimmer"]')).toBeNull()
    running.unmount()

    render(() => <ToolDisplay tool={skill({ id: "browser-control" })} onFileOpen={() => {}} />)
    expect(
      screen
        .getByLabelText("Loaded browser-control skill")
        .querySelector('[data-slot="tool-loaded-value"] [data-component="text-shimmer"]'),
    ).toHaveAttribute("data-active", "false")
  })

  it("renders the generic localized shimmer when the name is missing", () => {
    const view = render(() => <ToolDisplay tool={skill({}, {}, { type: "running" })} onFileOpen={() => {}} />)

    expect(screen.getByLabelText("Skill")).toHaveAttribute("data-active", "true")
    expect(view.container.querySelector('[data-slot="tool-icon"]')).toHaveAttribute("aria-hidden", "true")
  })

  it("uses the dedicated registry renderer without disclosure or output", () => {
    const view = render(() => (
      <ToolDisplay
        tool={skill({ id: "browser-control" }, {}, { type: "succeeded", output: "Instructions that must stay hidden" })}
        onFileOpen={() => {}}
        open
      />
    ))

    expect(screen.getByLabelText("Loaded browser-control skill")).toBeInTheDocument()
    expect(screen.queryByText("Instructions that must stay hidden")).not.toBeInTheDocument()
    expect(view.container.querySelector('[data-component="collapsible"]')).toBeNull()
    expect(view.container.querySelector('[data-slot="collapsible-arrow"]')).toBeNull()
    expect(view.container.querySelector('[data-component="tool-output"]')).toBeNull()
    expect(view.container.querySelector("button")).toBeNull()
  })

  it("emits the shared truncation slots for fixed labels and a flexible value", () => {
    const view = render(() => <ToolDisplay tool={skill({ id: "a-very-long-skill-name" })} onFileOpen={() => {}} />)
    const row = view.container.querySelector('[data-component="tool-loaded-item"]')

    expect(row?.children).toHaveLength(4)
    expect(row?.children[0]).toHaveAttribute("data-slot", "tool-icon")
    expect(row?.children[1]).toHaveAttribute("data-slot", "tool-loaded-label")
    expect(row?.children[2]).toHaveAttribute("data-slot", "tool-loaded-value")
    expect(row?.children[3]).toHaveAttribute("data-slot", "tool-loaded-kind")
  })
})

function skill(
  input: SessionUI.JsonRecord,
  metadata: SessionUI.JsonRecord = {},
  state: SessionUI.ToolState = { type: "succeeded" },
): SessionUI.ToolPart {
  return { type: "tool", id: "skill", name: "skill", input, metadata, state }
}
