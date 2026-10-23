import { cleanup, render, screen } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { afterEach, describe, expect, it } from "vitest"

import type { SessionUI } from "../session-model"
import { ToolDisplay } from "./tool-display"

afterEach(cleanup)

describe("Shell tool", () => {
  it("renders a running metadata command in an openable compact row", () => {
    const view = render(() => (
      <ToolDisplay tool={shell({}, { command: "bun typecheck" }, { type: "running" })} onFileOpen={() => {}} />
    ))

    expect(screen.getByRole("button", { name: "Shell bun typecheck Collapsed" })).toBeEnabled()
    expect(
      view.container.querySelector('[data-slot="basic-tool-tool-title"] [data-component="text-shimmer"]'),
    ).toHaveAttribute("data-active", "true")
    expect(view.container.querySelector('[data-component="shell-tool-trigger"]')).toHaveTextContent("bun typecheck")
  })

  it("renders structured output instead of its serialized result", () => {
    const view = render(() => (
      <ToolDisplay
        tool={shell(
          { command: "bun test" },
          {},
          {
            type: "succeeded",
            output: '{"stdout":"\\u001b[32m2 pass\\u001b[39m\\r\\n","stderr":"","exitCode":0}',
            result: { stdout: "\u001b[32m2 pass\u001b[39m\r\n", stderr: "", exitCode: 0 },
          },
        )}
        onFileOpen={() => {}}
        open
      />
    ))

    expect(view.container.querySelector('[data-slot="shell-command"]')).toHaveTextContent("bun test")
    expect(view.container.querySelector('[data-slot="shell-result"]')).toHaveTextContent("2 pass")
    expect(view.container.querySelector('[data-slot="shell-result"]')).not.toHaveTextContent("stdout")
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument()
  })
})

function shell(
  input: SessionUI.JsonRecord,
  metadata: SessionUI.JsonRecord,
  state: SessionUI.ToolState,
): SessionUI.ToolPart {
  return { type: "tool", id: "shell", name: "shell", input, metadata, state }
}
