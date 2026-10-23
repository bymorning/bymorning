import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { createSignal } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CopyAction } from "./message-action"
import { MessageTimeline } from "./message-timeline"
import type { SessionUI } from "./session-model"
import { UserMessage } from "./user-message"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const clipboard = () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
  return writeText
}

describe("message actions", () => {
  it("copies the latest reactive user message", async () => {
    const writeText = clipboard()
    const [text, setText] = createSignal("First")
    const view = render(() => <UserMessage message={{ id: "user", text: text() }} projectFiles={[]} />)
    setText("Updated")
    fireEvent.click(screen.getByRole("button", { name: "Copy message" }))
    await Promise.resolve()
    expect(writeText).toHaveBeenCalledWith("Updated")
    expect(view.container.querySelector('[data-component="message-action"]')).toHaveAttribute("data-owner", "user")
  })

  it("copies only assistant text", async () => {
    const writeText = clipboard()
    const view = render(() => (
      <MessageTimeline
        items={[assistantTurn()]}
        preferences={{ showAgent: true, showReasoning: true, showUsage: true }}
        projectFiles={[]}
        onFileOpen={() => {}}
      />
    ))
    fireEvent.click(screen.getByRole("button", { name: "Copy response" }))
    await Promise.resolve()
    expect(writeText).toHaveBeenCalledWith("answer")
    expect(
      view.container.querySelector('[data-component="message-action"][data-owner="assistant"]'),
    ).toBeInTheDocument()
    expect(view.container.querySelectorAll('[data-component="message-action"][data-owner="assistant"]')).toHaveLength(1)
  })

  it("shows copied feedback and resets it after two seconds", async () => {
    vi.useFakeTimers()
    clipboard()
    render(() => <CopyAction text="Answer" label="Copy response" />)
    fireEvent.click(screen.getByRole("button", { name: "Copy response" }))
    await Promise.resolve()
    await Promise.resolve()
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument()
    vi.advanceTimersByTime(2_000)
    expect(screen.getByRole("button", { name: "Copy response" })).toBeInTheDocument()
  })

  it("does not render actions for a tool-only assistant message", () => {
    const view = render(() => (
      <MessageTimeline
        items={[
          {
            type: "turn",
            id: "turn",
            assistant: [
              {
                id: "assistant",
                streaming: true,
                parts: [
                  { type: "tool", id: "tool", name: "lookup", input: {}, metadata: {}, state: { type: "running" } },
                ],
              },
            ],
            state: { type: "working" },
          },
        ]}
        preferences={{ showAgent: true, showReasoning: true, showUsage: true }}
        projectFiles={[]}
        onFileOpen={() => {}}
      />
    ))
    expect(view.container.querySelector('[data-component="message-action"]')).not.toBeInTheDocument()
  })

  it("renders interrupted metadata on the selected text part", () => {
    const view = render(() => (
      <MessageTimeline
        items={[{ ...assistantTurn(), state: { type: "interrupted" } }]}
        preferences={{ showAgent: true, showReasoning: true, showUsage: true }}
        projectFiles={[]}
        onFileOpen={() => {}}
      />
    ))
    const action = view.container.querySelector('[data-component="message-action"][data-owner="assistant"]')

    expect(action).toHaveAttribute("data-interrupted")
    expect(action).toHaveTextContent("build · Final Model · 7s")
    expect(action).toHaveTextContent("Interrupted")
  })
})

function assistantTurn(): SessionUI.Turn {
  return {
    type: "turn",
    id: "turn",
    user: { id: "user", text: "Question" },
    assistant: [
      {
        id: "assistant-one",
        streaming: false,
        details: { agent: "explore", model: "First Model", durationMs: 3_000 },
        parts: [{ type: "text", id: "one", text: "Public" }],
      },
      {
        id: "assistant-two",
        streaming: false,
        details: { agent: "build", model: "Final Model", durationMs: 7_000 },
        parts: [
          { type: "reasoning", id: "reasoning", text: "Private chain" },
          { type: "text", id: "two", text: "answer" },
        ],
      },
    ],
    state: { type: "complete" },
  }
}
