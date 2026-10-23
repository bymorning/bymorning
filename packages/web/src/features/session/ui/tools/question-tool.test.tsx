import { cleanup, render } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { afterEach, describe, expect, it } from "vitest"

import type { SessionUI } from "../session-model"
import { ToolDisplay } from "./tool-display"

afterEach(cleanup)

const input = {
  questions: [
    { question: "Who are you?", header: "Name", options: [] },
    { question: "Favourite colour?", header: "Colour", options: [] },
  ],
}

function question(state: SessionUI.ToolState, toolInput: SessionUI.JsonRecord = input): SessionUI.ToolPart {
  return { type: "tool", id: "question", name: "question", input: toolInput, metadata: {}, state }
}

describe("Question tool", () => {
  it("summarizes answers beside the asked questions instead of raw JSON", () => {
    const view = render(() => (
      <ToolDisplay
        tool={question({
          type: "succeeded",
          output: '{"answers":[["Ada"],["Green"]]}',
          result: { answers: [["Ada"], ["Green"]] },
        })}
        onFileOpen={() => {}}
        open
      />
    ))

    const rows = [...view.container.querySelectorAll('[data-slot="question-answer"]')].map((row) => row.textContent)
    expect(rows).toEqual(["Who are you?Ada", "Favourite colour?Green"])
    expect(view.container).not.toHaveTextContent('{"answers"')
  })

  it("reads answers from the output text and marks empty ones", () => {
    const view = render(() => (
      <ToolDisplay
        tool={question({ type: "succeeded", output: '{"answers":[["Ada","Bo"],[]]}' })}
        onFileOpen={() => {}}
        open
      />
    ))

    const rows = [...view.container.querySelectorAll('[data-slot="question-answer"]')].map((row) => row.textContent)
    expect(rows).toEqual(["Who are you?Ada, Bo", "Favourite colour?Unanswered"])
  })

  it("falls back to the generic row when the result carries no answers", () => {
    const view = render(() => (
      <ToolDisplay tool={question({ type: "succeeded", output: "done" }, {})} onFileOpen={() => {}} open />
    ))

    expect(view.container.querySelector('[data-component="question-answers"]')).toBeNull()
    expect(view.container).toHaveTextContent("done")
  })
})
