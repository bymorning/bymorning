import { cleanup, render } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { afterEach, describe, expect, it } from "vitest"

import type { SessionUI } from "../session-model"
import { ToolDisplay } from "./tool-display"

afterEach(cleanup)

describe("Execute tool", () => {
  it("renders code and its output", () => {
    const view = render(() => (
      <ToolDisplay
        tool={execute({ code: "const value = 1\nreturn value" }, { type: "succeeded", output: "1" })}
        onFileOpen={() => {}}
        open
      />
    ))

    expect(view.container.querySelector('[data-component="execute-tool-trigger"]')).toHaveTextContent("const value = 1")
    expect(view.container.querySelector('[data-slot="execute-code"]')).toHaveTextContent("const value = 1 return value")
    expect(view.container.querySelector('[data-slot="execute-result"]')).toHaveTextContent("1")
  })

  it("drops leading blank lines from the code body", () => {
    const view = render(() => (
      <ToolDisplay
        tool={execute({ code: "\n\n  const value = 1" }, { type: "succeeded", output: "1" })}
        onFileOpen={() => {}}
        open
      />
    ))

    expect(view.container.querySelector('[data-slot="execute-code"]')?.textContent).toBe("  const value = 1")
  })

  it("shows the input description instead of code in the trigger", () => {
    const view = render(() => (
      <ToolDisplay
        tool={execute(
          { description: "Return one", code: "const value = 1\nreturn value" },
          { type: "succeeded", output: "1" },
        )}
        onFileOpen={() => {}}
        open
      />
    ))

    expect(view.container.querySelector('[data-component="execute-tool-trigger"]')).toHaveTextContent("Return one")
    expect(view.container.querySelector('[data-component="execute-tool-trigger"]')).not.toHaveTextContent("const value")
    expect(view.container.querySelector('[data-slot="execute-code"]')).toHaveTextContent("const value = 1 return value")
  })

  it("keeps a described call's description in the expanded header", () => {
    const view = render(() => (
      <ToolDisplay
        tool={execute({ description: "Return one", code: "return 1" }, { type: "succeeded", output: "1" })}
        onFileOpen={() => {}}
        open
      />
    ))

    const trigger = view.container.querySelector('[data-component="execute-tool-trigger"]')
    expect(trigger).toHaveAttribute("data-label", "description")
    expect(trigger?.querySelector('[data-slot="basic-tool-tool-subtitle"]')).toHaveTextContent("Return one")
  })

  it("marks a call cut short by Stop instead of leaving a bare title", () => {
    const view = render(() => <ToolDisplay tool={execute({}, { type: "interrupted" })} onFileOpen={() => {}} />)

    expect(view.container.querySelector('[data-component="execute-tool-trigger"]')).toHaveTextContent("Execute")
    expect(view.container.querySelector('[data-slot="execute-tool-ended"]')).toHaveTextContent("Interrupted")
  })

  it("uses the core execute path and structured result", () => {
    const view = render(() => (
      <ToolDisplay
        tool={execute(
          { path: "scripts/check.ts" },
          { type: "succeeded", result: { stdout: "OK", stderr: "", exitCode: 0 } },
        )}
        onFileOpen={() => {}}
        open
      />
    ))

    expect(view.container.querySelector('[data-component="execute-tool-trigger"]')).toHaveTextContent(
      "scripts/check.ts",
    )
    expect(view.container.querySelector('[data-slot="execute-code"]')).toHaveTextContent("scripts/check.ts")
    expect(view.container.querySelector('[data-slot="execute-result"]')).toHaveTextContent("OK")
  })

  it("shows a Code Mode result's output instead of its JSON envelope", () => {
    const view = render(() => (
      <ToolDisplay
        tool={execute(
          { code: "return fib(20)" },
          {
            type: "succeeded",
            output: '{"output":"6765","toolCalls":[],"files":[]}',
            result: { output: "6765", toolCalls: [], files: [] },
          },
        )}
        onFileOpen={() => {}}
        open
      />
    ))

    expect(view.container.querySelector('[data-slot="execute-result"]')?.textContent).toBe("6765")
    expect(view.container.querySelector('[data-slot="execute-result"]')).not.toHaveAttribute("data-error")
    expect(view.container.querySelector('[data-slot="execute-tool-failed"]')).toBeNull()
  })

  it("flags a Code Mode error result in the collapsed row", () => {
    const view = render(() => (
      <ToolDisplay
        tool={execute(
          { code: "throw new Error('boom')" },
          { type: "succeeded", result: { output: "Error: boom", toolCalls: [], files: [], error: true } },
        )}
        onFileOpen={() => {}}
      />
    ))

    expect(view.container.querySelector('[data-component="execute-tool-trigger"]')).toHaveTextContent("Failed")
  })
})

function execute(input: SessionUI.JsonRecord, state: SessionUI.ToolState): SessionUI.ToolPart {
  return { type: "tool", id: "execute", name: "execute", input, metadata: {}, state }
}
