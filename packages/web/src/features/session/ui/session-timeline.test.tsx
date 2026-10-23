import { cleanup, render, screen } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { createSignal } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"

import { MessageTimeline } from "./message-timeline"
import type { SessionUI } from "./session-model"
import { SessionTimeline } from "./session-timeline"
import { projectTimeline } from "../timeline/projection"

const preferences = { showAgent: true, showReasoning: true, showUsage: true }
const onFileOpen = () => {}
const user = { id: "user", text: "Hello" }
const turn = (assistant: SessionUI.Turn["assistant"], state: SessionUI.TurnState): SessionUI.Turn => ({
  type: "turn",
  id: "user",
  user,
  assistant,
  state,
})

afterEach(() => {
  cleanup()
})

describe("Session timeline", () => {
  it("shows assistant Markdown source in raw mode", () => {
    const view = render(() => (
      <MessageTimeline
        items={[
          turn(
            [
              {
                id: "assistant",
                parts: [{ type: "text", id: "answer", text: "# Answer\n\n**Exact**" }],
                streaming: false,
              },
            ],
            { type: "complete" },
          ),
        ]}
        projectFiles={[]}
        preferences={preferences}
        renderMarkdown={false}
        onFileOpen={onFileOpen}
      />
    ))

    expect(screen.queryByRole("heading", { name: "Answer" })).not.toBeInTheDocument()
    expect(view.container.querySelector('[data-component="markdown"]')).not.toBeInTheDocument()
    expect(view.container.querySelector('[data-component="raw-text"]')).toHaveTextContent("# Answer **Exact**")
  })

  it("renders the background hint in the bottom footer without adding a transcript row", () => {
    const projection = projectTimeline([turn([], { type: "working" })], preferences)
    render(() => (
      <SessionTimeline
        model={{ state: "ready", items: [], ...projection }}
        projectFiles={[]}
        preferences={preferences}
        onFileOpen={onFileOpen}
        footer={<div role="status">Continue in background</div>}
      />
    ))
    expect(screen.getByText("Continue in background")).toBeInTheDocument()
    expect(document.querySelector('[data-slot="timeline-bottom-footer"]')).toBeInTheDocument()
    expect(document.querySelectorAll("[data-timeline-key]")).toHaveLength(projection.rows.length)
  })

  it("keeps the header while loading, then renders failure and empty ready states", () => {
    const view = render(() => (
      <SessionTimeline
        model={{ state: "loading" }}
        projectFiles={[]}
        preferences={preferences}
        onFileOpen={onFileOpen}
        header={<h1>Child session</h1>}
      />
    ))
    expect(screen.getByRole("heading", { name: "Child session" })).toBeInTheDocument()
    expect(view.container.querySelectorAll("h1")).toHaveLength(1)
    view.unmount()
    render(() => (
      <SessionTimeline
        model={{ state: "failed", message: "Offline" }}
        projectFiles={[]}
        preferences={preferences}
        onFileOpen={onFileOpen}
      />
    ))
    expect(screen.getByRole("alert")).toHaveTextContent("Offline")
    expect(screen.getByRole("alert")).toHaveAttribute("data-slot", "session-timeline-error")
    expect(screen.getByRole("alert")).toBeVisible()
    cleanup()
    render(() => (
      <SessionTimeline
        model={{ state: "ready", items: [], ...projectTimeline([], preferences) }}
        projectFiles={[]}
        preferences={preferences}
        onFileOpen={onFileOpen}
      />
    ))
    expect(screen.getByText("No messages yet.")).toBeInTheDocument()
  })

  it("renders compaction as a lifecycle notice", () => {
    render(() => (
      <MessageTimeline
        items={[
          {
            type: "notice",
            id: "compaction",
            kind: "compaction",
            text: "Session compacted",
            detail: "running",
          },
        ]}
        projectFiles={[]}
        preferences={preferences}
        onFileOpen={onFileOpen}
      />
    ))
    expect(screen.getByText("Session compacted")).toBeInTheDocument()
    expect(screen.getByText(/running/)).toBeInTheDocument()
    expect(screen.getByText("Session compacted").closest('[data-component="session-notice"]')).toHaveAttribute(
      "data-kind",
      "compaction",
    )
  })

  it("styles exact file and skill references in user messages", () => {
    const view = render(() => (
      <MessageTimeline
        items={[
          {
            ...turn([], { type: "complete" }),
            user: { id: "user", text: "Review @README.md with @browser-control and @missing.md" },
          },
        ]}
        projectFiles={["README.md"]}
        skills={[{ id: "browser-control", name: "Browser Control" }]}
        preferences={preferences}
        onFileOpen={onFileOpen}
      />
    ))

    expect(
      view.container.querySelector('[data-component="project-file-reference"][data-path="README.md"]'),
    ).toHaveTextContent("@README.md")
    expect(view.container.querySelectorAll('[data-component="project-file-reference"]')).toHaveLength(1)
    expect(
      view.container.querySelector('[data-component="skill-reference"][data-skill-id="browser-control"]'),
    ).toHaveTextContent("@browser-control")
    expect(screen.getByText(/@missing\.md/)).toBeInTheDocument()
  })

  it("uses the transcript frame and message-part semantic hierarchy", () => {
    const view = render(() => (
      <MessageTimeline
        items={[
          turn(
            [
              {
                id: "assistant",
                parts: [
                  { type: "text", id: "answer", text: "Answer" },
                  { type: "reasoning", id: "reasoning", text: "Reasoning" },
                ],
                streaming: false,
                details: {
                  agent: "build",
                  model: "Model",
                  durationMs: 2_000,
                  usage: { tokens: 123, cost: 0.04, costComplete: true },
                },
              },
            ],
            { type: "complete" },
          ),
        ]}
        projectFiles={[]}
        preferences={preferences}
        onFileOpen={onFileOpen}
      />
    ))
    const userFrame = view.container.querySelector('[data-message-id="user"][data-timeline-row="UserMessage"]')!
    const assistantFrames = view.container.querySelectorAll(
      '[data-message-id="user"][data-timeline-row="AssistantPart"]',
    )

    expect(userFrame).toHaveAttribute("id", "message-user")
    expect(
      userFrame.querySelector('[data-component="session-turn"] > [data-slot="session-turn-message-container"]'),
    ).toBeInTheDocument()
    expect(userFrame.querySelector('[data-component="user-message"]')).toHaveAttribute(
      "data-timeline-part-id",
      "user:text:0",
    )
    expect(assistantFrames).toHaveLength(2)
    expect(assistantFrames[0]).not.toHaveAttribute("data-previous-assistant-part")
    expect(assistantFrames[1]).toHaveAttribute("data-previous-assistant-part", "")
    expect(assistantFrames[0]!.querySelector('[data-component="text-part"]')).toHaveAttribute(
      "data-timeline-part-id",
      "answer",
    )
    expect(assistantFrames[1]!.querySelector('[data-component="reasoning-part"]')).toHaveAttribute(
      "data-timeline-part-id",
      "reasoning",
    )
    expect(assistantFrames[0]!.querySelector('[data-slot="text-part-copy-wrapper"]')).toHaveTextContent(
      "build · Model · 2s · 123 tokens · $0.04",
    )
  })

  it("shows Thinking while working unless a tool or stream is already live", () => {
    const view = render(() => (
      <MessageTimeline
        items={[turn([], { type: "working" })]}
        projectFiles={[]}
        preferences={preferences}
        onFileOpen={onFileOpen}
      />
    ))
    expect(screen.getByRole("status")).toHaveAccessibleName("Thinking")
    expect(view.container.querySelector('[data-timeline-row="Thinking"]')).toBeInTheDocument()
    view.unmount()
    const running = render(() => (
      <MessageTimeline
        items={[
          turn(
            [
              {
                id: "assistant",
                parts: [
                  { type: "tool", id: "tool", name: "lookup", input: {}, metadata: {}, state: { type: "running" } },
                ],
                streaming: true,
              },
            ],
            { type: "working" },
          ),
        ]}
        projectFiles={[]}
        preferences={preferences}
        onFileOpen={onFileOpen}
      />
    ))
    expect(screen.queryByLabelText("Thinking")).not.toBeInTheDocument()
    running.unmount()
    render(() => (
      <MessageTimeline
        items={[
          turn(
            [
              {
                id: "assistant",
                parts: [
                  { type: "tool", id: "tool", name: "lookup", input: {}, metadata: {}, state: { type: "succeeded" } },
                ],
                streaming: true,
              },
            ],
            { type: "working" },
          ),
        ]}
        projectFiles={[]}
        preferences={preferences}
        onFileOpen={onFileOpen}
      />
    ))
    expect(screen.getByRole("status")).toHaveAccessibleName("Thinking")
  })

  it("shows an accessible retry schedule and clears it without replacing existing content", () => {
    const at = new Date(2026, 0, 1, 14, 3, 5).getTime()
    const [message, setMessage] = createSignal<SessionUI.AssistantMessage>({
      id: "assistant",
      parts: [{ type: "tool", id: "lookup", name: "lookup", input: {}, metadata: {}, state: { type: "running" } }],
      streaming: true,
      retry: { attempt: 2, at },
    })
    const view = render(() => (
      <MessageTimeline
        items={[turn([message()], { type: "working" })]}
        projectFiles={[]}
        preferences={preferences}
        onFileOpen={onFileOpen}
      />
    ))
    const content = view.container.querySelector('[data-timeline-key="assistant-part:part:assistant:lookup"]')
    expect(screen.getByRole("status")).toHaveTextContent("Retrying · attempt 2 · scheduled 14:03:05")

    setMessage({ id: "assistant", parts: message().parts, streaming: true })

    expect(screen.queryByText(/Retrying · attempt 2/)).not.toBeInTheDocument()
    expect(view.container.querySelector('[data-timeline-key="assistant-part:part:assistant:lookup"]')).toBe(content)
  })

  it("hides reasoning summaries without hiding active Thinking", () => {
    const view = render(() => (
      <MessageTimeline
        items={[
          turn(
            [
              {
                id: "assistant",
                parts: [{ type: "reasoning", id: "reasoning", text: "A summary" }],
                streaming: true,
              },
            ],
            { type: "working" },
          ),
        ]}
        projectFiles={[]}
        preferences={{ showAgent: true, showReasoning: false, showUsage: true }}
        onFileOpen={onFileOpen}
      />
    ))
    expect(screen.queryByText("A summary")).not.toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveAccessibleName("Thinking")
    expect(view.container.querySelector('[data-timeline-row="Thinking"]')).toBeInTheDocument()
  })

  it("preserves Markdown DOM across equivalent timeline models", () => {
    const items = (): ReadonlyArray<SessionUI.Item> => [
      turn([{ id: "assistant", parts: [{ type: "text", id: "answer", text: "**Answer**" }], streaming: false }], {
        type: "complete",
      }),
    ]
    const [value, setValue] = createSignal(items())
    const view = render(() => (
      <MessageTimeline items={value()} projectFiles={[]} preferences={preferences} onFileOpen={onFileOpen} />
    ))
    const markdown = view.container.querySelector('[data-component="markdown"]')
    setValue(items())
    expect(view.container.querySelector('[data-component="markdown"]')).toBe(markdown)
  })

  it("keeps keyed assistant DOM when an older user row is attached", () => {
    const assistant = {
      id: "assistant",
      parts: [{ type: "text" as const, id: "answer", text: "Answer" }],
      streaming: false,
    }
    const leadingItems: ReadonlyArray<SessionUI.Item> = [
      { type: "turn", id: "assistant", assistant: [assistant], state: { type: "complete" } },
    ]
    const attachedItems: ReadonlyArray<SessionUI.Item> = [turn([assistant], { type: "complete" })]
    const leading = projectTimeline(leadingItems, preferences)
    const [projection, setProjection] = createSignal(leading)
    const view = render(() => (
      <MessageTimeline projection={projection()} projectFiles={[]} preferences={preferences} onFileOpen={onFileOpen} />
    ))
    const markdown = view.container.querySelector(
      '[data-timeline-key="assistant-part:part:assistant:answer"] [data-component="markdown"]',
    )

    setProjection(projectTimeline(attachedItems, preferences, leading.rows))

    expect(view.container.querySelector('[data-timeline-key="user-message:user"]')).toBeInTheDocument()
    expect(
      view.container.querySelector(
        '[data-timeline-key="assistant-part:part:assistant:answer"] [data-component="markdown"]',
      ),
    ).toBe(markdown)
  })

  it("reactively changes a reused message part from a tool to text", async () => {
    const tool = {
      type: "tool",
      id: "tool",
      name: "read",
      input: {},
      metadata: {},
      state: { type: "succeeded" },
    } as const
    const [message, setMessage] = createSignal<SessionUI.AssistantMessage>({
      id: "assistant",
      parts: [tool],
      streaming: false,
    })
    const view = render(() => (
      <MessageTimeline
        items={[turn([message()], { type: "complete" })]}
        projectFiles={[]}
        preferences={preferences}
        onFileOpen={onFileOpen}
      />
    ))
    expect(screen.getByRole("button", { name: "Explored Collapsed" })).toBeInTheDocument()
    const toolRow = view.container.querySelector('[data-timeline-key="assistant-part:context:assistant:tool"]')

    setMessage({
      id: "assistant",
      parts: [{ type: "text", id: "answer", text: "File contents" }, tool],
      streaming: false,
    })
    expect(await screen.findByText("File contents")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Explored Collapsed" })).toBeInTheDocument()
    expect(view.container.querySelector('[data-timeline-key="assistant-part:context:assistant:tool"]')).toBe(toolRow)
  })

  it("renders interrupted and failed turns honestly", () => {
    const view = render(() => (
      <MessageTimeline
        items={[turn([], { type: "interrupted" })]}
        projectFiles={[]}
        preferences={preferences}
        onFileOpen={onFileOpen}
      />
    ))
    expect(screen.getByText("Interrupted")).toBeInTheDocument()
    expect(view.container.querySelector('[data-timeline-row="TurnDivider"]')).toBeInTheDocument()
    view.unmount()
    render(() => (
      <MessageTimeline
        items={[turn([], { type: "failed", failure: { type: "generic", message: "Provider failed" } })]}
        projectFiles={[]}
        preferences={preferences}
        onFileOpen={onFileOpen}
      />
    ))
    expect(screen.getByRole("alert")).toHaveTextContent("Provider failed")
  })

  it("renders a rich Policy failure card without changing generic failures", () => {
    const view = render(() => (
      <MessageTimeline
        items={[
          turn([], {
            type: "failed",
            failure: { type: "policy", agent: "Build", model: "Qwen3.7 Plus" },
          }),
        ]}
        projectFiles={[]}
        preferences={preferences}
        onFileOpen={onFileOpen}
        actions={{
          sessionHref: () => undefined,
          openSession: () => {},
          sessionStatus: () => "idle",
        }}
      />
    ))

    const alert = screen.getByRole("alert")
    expect(screen.getByRole("heading", { name: "Request blocked by policy" })).toBeInTheDocument()
    expect(alert).toHaveTextContent("A Workspace policy prevented Qwen3.7 Plus from handling this request.")
    expect(alert).toHaveTextContent("AgentBuild")
    expect(alert).toHaveTextContent("ModelQwen3.7 Plus")
    expect(screen.queryByRole("link", { name: "Review plugins" })).not.toBeInTheDocument()
    expect(view.container.querySelector(".policy-error-card")).toBeInTheDocument()
  })
})
