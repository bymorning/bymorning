import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { createSignal } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"

import type { SessionUI } from "./session-model"
import { ContextToolGroup, FileToolGroup } from "./tool-group"

afterEach(cleanup)

const entry = (part: SessionUI.ToolPart): SessionUI.TimelinePartEntry => ({
  messageID: "assistant",
  part,
  streaming: part.state.type === "running",
})

describe("timeline tool groups", () => {
  it("summarizes context tools and discloses their OpenCode-style path and argument rows while running", () => {
    const [open, setOpen] = createSignal(false)
    render(() => (
      <ContextToolGroup
        entries={[
          entry({
            type: "tool",
            id: "read",
            name: "read",
            input: { path: "src/session.ts", offset: 20, limit: 40 },
            metadata: {},
            state: { type: "running" },
          }),
          entry({
            type: "tool",
            id: "grep",
            name: "grep",
            input: { path: "src", pattern: "ToolDisplay", include: "*.tsx" },
            metadata: { matches: 2 },
            state: { type: "succeeded" },
          }),
        ]}
        open={open()}
        onOpenChange={setOpen}
      />
    ))

    const trigger = screen.getByRole("button", { name: "Exploring Collapsed" })
    expect(trigger).toHaveTextContent("1 read · 1 search")
    fireEvent.click(trigger)
    expect(screen.getByRole("button", { name: "Exploring Expanded" })).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("session.ts")).toBeInTheDocument()
    expect(screen.getByText("offset=20")).toBeInTheDocument()
    expect(screen.getByText("pattern=ToolDisplay")).toBeInTheDocument()
    expect(screen.getByText("(2 matches)")).toBeInTheDocument()
  })

  it("keeps grouped file disclosure in externally owned state across remounts", () => {
    const [open, setOpen] = createSignal(false)
    const entries = [
      entry({
        type: "tool",
        id: "edit",
        name: "edit",
        input: {},
        metadata: {
          files: [
            {
              file: "src/session.ts",
              patch: "@@ -1 +1 @@\n-old\n+new",
              additions: 1,
              deletions: 1,
              status: "modified",
            },
          ],
        },
        state: { type: "succeeded" },
      }),
    ]
    const mount = () =>
      render(() => (
        <FileToolGroup entries={entries} fileOpen={() => open()} onFileOpenChange={(_path, value) => setOpen(value)} />
      ))

    const first = mount()
    expect(screen.queryByRole("region", { name: "Diff for src/session.ts" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /src\/session\.ts/i }))
    expect(screen.getByRole("region", { name: "Diff for src/session.ts" })).toHaveTextContent("+new")
    first.unmount()

    mount()
    expect(screen.getByRole("region", { name: "Diff for src/session.ts" })).toBeInTheDocument()
  })

  it("preserves grouped tool DOM identity when sibling payloads update", () => {
    const read = (id: string, path: string, state: SessionUI.ToolState) =>
      entry({ type: "tool", id, name: "read", input: { path }, metadata: {}, state })
    const [entries, setEntries] = createSignal([
      read("first", "src/first.ts", { type: "running" }),
      read("second", "src/second.ts", { type: "succeeded" }),
    ])
    const view = render(() => <ContextToolGroup entries={entries()} open />)
    const second = screen.getByText("second.ts").closest('[data-slot="context-tool-group-item"]')

    setEntries([
      read("first", "src/first.ts", { type: "succeeded" }),
      read("second", "src/second.ts", { type: "succeeded" }),
    ])

    expect(screen.getByText("second.ts").closest('[data-slot="context-tool-group-item"]')).toBe(second)
    expect(view.container.querySelectorAll('[data-slot="context-tool-group-item"]')).toHaveLength(2)
  })

  it("preserves unchanged file DOM when sibling patches update", () => {
    const edit = (firstPatch: string) =>
      entry({
        type: "tool",
        id: "edit",
        name: "edit",
        input: {},
        metadata: {
          files: [
            { file: "src/first.ts", patch: firstPatch, additions: 1, deletions: 1, status: "modified" },
            { file: "src/second.ts", patch: "second", additions: 1, deletions: 0, status: "modified" },
          ],
        },
        state: { type: "succeeded" },
      })
    const [entries, setEntries] = createSignal([edit("first")])
    render(() => <FileToolGroup entries={entries()} />)
    const second = screen.getByRole("button", { name: /src\/second\.ts/i })

    setEntries([edit("updated first")])

    expect(screen.getByRole("button", { name: /src\/second\.ts/i })).toBe(second)
  })
})
