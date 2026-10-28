import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { createSignal } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ToolDisplay } from "./tool-display"
import { ToolRegistry } from "./tool-registry"

afterEach(cleanup)

const tool = (name: string) => ({
  type: "tool" as const,
  id: name,
  name,
  input: {},
  metadata: {},
  state: { type: "succeeded" as const },
})

describe("ToolDisplay", () => {
  it("capitalises the name of a failed tool like the other tool labels", () => {
    const { container } = render(() => (
      <ToolDisplay
        tool={{ ...tool("run"), input: { path: "x.py" }, state: { type: "failed", message: "Unavailable" } }}
        onFileOpen={() => {}}
      />
    ))

    expect(container.querySelector('[data-slot="basic-tool-tool-title"]')).toHaveTextContent(/^Run$/)
  })

  it("leaves controlled disclosure state with its parent and links its region", () => {
    const [open, setOpen] = createSignal(false)
    const onOpenChange = vi.fn()
    render(() => (
      <ToolDisplay
        tool={{ ...tool("write"), state: { type: "failed", message: "Disk full" } }}
        onFileOpen={() => {}}
        open={open()}
        onOpenChange={onOpenChange}
      />
    ))
    const trigger = screen.getByRole("button", { name: /write Failed Collapsed/i })
    fireEvent.click(trigger)
    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(trigger).toHaveAttribute("aria-expanded", "false")

    setOpen(true)
    const expandedTrigger = screen.getByRole("button", { name: /write Failed Expanded/i })
    const region = screen.getByRole("region", { name: /write Failed Expanded/i })
    expect(expandedTrigger).toHaveAttribute("aria-controls", region.id)
    expect(region).toHaveAttribute("aria-labelledby", expandedTrigger.id)
  })

  it("keeps a controlled error disclosure semantic across remounts", () => {
    const [open, setOpen] = createSignal(false)
    const mount = () =>
      render(() => (
        <ToolDisplay
          tool={{ ...tool("edit"), input: { path: "src/error.ts" }, state: { type: "failed", message: "No match" } }}
          onFileOpen={() => {}}
          open={open()}
          onOpenChange={setOpen}
        />
      ))
    const first = mount()
    const trigger = screen.getByRole("button", { name: /edit src\/error\.ts Failed Collapsed/i })
    const contentID = trigger.getAttribute("aria-controls")
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    expect(contentID).not.toBeNull()
    if (contentID === null) throw new Error("Expected error disclosure trigger to control content")
    expect(document.getElementById(contentID)).toHaveAttribute("hidden")
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("region", { name: /edit src\/error\.ts Failed Expanded/i })).not.toHaveAttribute("hidden")
    first.unmount()

    mount()
    expect(screen.getByRole("button", { name: /edit src\/error\.ts Failed Expanded/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
    fireEvent.click(screen.getByRole("button", { name: /edit src\/error\.ts Failed Expanded/i }))
    expect(screen.getByRole("button", { name: /edit src\/error\.ts Failed Collapsed/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    )
  })

  it("selects registered renderers and falls back for unknown tools", () => {
    ToolRegistry.register({ name: "test-registered", render: () => <div>Registered renderer</div> })
    const registered = render(() => <ToolDisplay tool={tool("test-registered")} onFileOpen={() => {}} />)
    expect(screen.getByText("Registered renderer")).toBeInTheDocument()
    registered.unmount()
    render(() => <ToolDisplay tool={tool("not-registered")} onFileOpen={() => {}} />)
    expect(screen.getByRole("button", { name: "Called not-registered" })).toBeInTheDocument()
    cleanup()
    render(() => <ToolDisplay tool={tool("constructor")} onFileOpen={() => {}} />)
    expect(screen.getByRole("button", { name: "Called constructor" })).toBeInTheDocument()
  })

  it("centralizes failures before dispatching registered renderers", () => {
    const registered = vi.fn(() => <div>Should not render</div>)
    ToolRegistry.register({ name: "test-failure", render: registered })
    render(() => (
      <ToolDisplay
        tool={{ ...tool("test-failure"), state: { type: "failed", message: "Disk full" } }}
        onFileOpen={() => {}}
      />
    ))
    expect(screen.getByText("Failed")).toBeInTheDocument()
    expect(registered).not.toHaveBeenCalled()
  })

  it("keeps Failed accessible alongside a failed file path", () => {
    render(() => (
      <ToolDisplay
        tool={{
          ...tool("edit"),
          input: { path: "src/a.ts", oldString: "old", newString: "new" },
          state: { type: "failed", message: "No match" },
        }}
        onFileOpen={() => {}}
      />
    ))
    expect(screen.getByRole("button", { name: /edit src\/a\.ts Failed/i })).toBeInTheDocument()
  })

  it("renders structured writes and opens their file", () => {
    const open = vi.fn()
    const view = render(() => (
      <ToolDisplay
        tool={{ ...tool("write"), input: { path: "README.md", content: "# Project" } }}
        onFileOpen={open}
        open
      />
    ))
    expect(screen.getByText("# Project")).toBeInTheDocument()
    expect(view.container.querySelector("[data-slot='file-tool-path'] bdi")).toHaveTextContent("README.md")
    fireEvent.click(screen.getByRole("button", { name: "Open file" }))
    expect(open).toHaveBeenCalledWith("README.md")
  })

  it("bidi-isolates collapsed file summaries at the rendering sink", () => {
    render(() => (
      <ToolDisplay
        tool={{ ...tool("write"), input: { path: "src/\u05d0.ts", content: "content" } }}
        onFileOpen={() => {}}
      />
    ))
    expect(screen.getByRole("button", { name: /Write src\/\u05d0\.ts/ }).querySelector("bdi")).toHaveTextContent(
      "src/\u05d0.ts",
    )
  })

  it("parses edits and describes replace-all without claiming a complete diff", () => {
    render(() => (
      <ToolDisplay
        tool={{
          ...tool("edit"),
          input: { path: "src/a.ts", oldString: "old", newString: "new", replaceAll: true },
          state: { type: "succeeded", result: { replacements: 3 } },
        }}
        onFileOpen={() => {}}
        open
      />
    ))
    expect(screen.getByText("3 replacements; the preview shows the replacement pattern once.")).toBeInTheDocument()
    expect(screen.getByText("old")).toHaveAttribute("data-change-kind", "delete")
    expect(screen.getByRole("group", { name: "Content changes" })).toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Old content" })).toHaveTextContent("old")
    expect(screen.getByText("new")).toHaveAttribute("data-change-kind", "add")
    expect(screen.getByRole("region", { name: "New content" })).toHaveTextContent("new")
  })

  it("prefers validated edit diff metadata", () => {
    render(() => (
      <ToolDisplay
        tool={{
          ...tool("edit"),
          input: { path: "src/a.ts", oldString: "pattern", newString: "replacement" },
          metadata: {
            files: [
              {
                file: "src/a.ts",
                status: "modified",
                additions: 1,
                deletions: 1,
                patch: "@@ -1 +1 @@\n-old value\n+new value",
              },
            ],
          },
        }}
        onFileOpen={() => {}}
        open
      />
    ))
    expect(screen.getByRole("region", { name: "Diff for src/a.ts" })).toHaveTextContent("-old value")
    expect(screen.getByLabelText("1 additions and 1 deletions")).toHaveTextContent("+1 -1")
    expect(screen.queryByText("pattern")).not.toBeInTheDocument()
  })

  it("ignores empty edit metadata paths instead of overriding valid input", () => {
    const openFile = vi.fn()
    render(() => (
      <ToolDisplay
        tool={{
          ...tool("edit"),
          input: { path: "src/a.ts", oldString: "fallback old", newString: "fallback new" },
          metadata: {
            files: [
              {
                file: "",
                status: "modified",
                additions: 1,
                deletions: 1,
                patch: "invalid metadata patch",
              },
            ],
          },
        }}
        onFileOpen={openFile}
        open
      />
    ))
    expect(screen.getByRole("button", { name: /Edit src\/a\.ts/ })).toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Old content" })).toHaveTextContent("fallback old")
    expect(screen.queryByText("invalid metadata patch")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Open file" }))
    expect(openFile).toHaveBeenCalledWith("src/a.ts")
  })

  it("renders validated write error diagnostics", () => {
    render(() => (
      <ToolDisplay
        tool={{
          ...tool("write"),
          input: { path: "src/a.ts", content: "const value =" },
          metadata: {
            diagnostics: {
              "src/a.ts": [
                { severity: 1, message: "Expression expected", range: { start: { line: 2, character: 4 } } },
                { severity: 2, message: "Ignored warning", range: { start: { line: 0, character: 0 } } },
              ],
            },
          },
        }}
        onFileOpen={() => {}}
        open
      />
    ))
    expect(screen.getByRole("list", { name: "Write errors" })).toHaveTextContent("Error [3:5] Expression expected")
    expect(screen.queryByText(/Ignored warning/)).not.toBeInTheDocument()
  })

  it("renders validated edit error diagnostics", () => {
    render(() => (
      <ToolDisplay
        tool={{
          ...tool("edit"),
          input: { path: "src/a.ts", oldString: "old", newString: "new" },
          metadata: {
            diagnostics: {
              "src/a.ts": [
                { severity: 1, message: "Type mismatch", range: { start: { line: 4, character: 2 } } },
                { severity: 2, message: "Ignored warning", range: { start: { line: 0, character: 0 } } },
              ],
            },
          },
        }}
        onFileOpen={() => {}}
        open
      />
    ))
    expect(screen.getByRole("list", { name: "Edit errors" })).toHaveTextContent("Error [5:3] Type mismatch")
    expect(screen.queryByText(/Ignored warning/)).not.toBeInTheDocument()
  })

  it("rejects invalid diff counts and diagnostic coordinates", () => {
    render(() => (
      <ToolDisplay
        tool={{
          ...tool("edit"),
          input: { path: "src/a.ts", oldString: "fallback old", newString: "fallback new" },
          metadata: {
            files: [
              {
                file: "src/a.ts",
                status: "modified",
                additions: 1.5,
                deletions: 0,
                patch: "invalid patch",
              },
            ],
            diagnostics: {
              "src/a.ts": [
                { severity: 1, message: "Negative", range: { start: { line: -1, character: 0 } } },
                { severity: 1, message: "Fractional", range: { start: { line: 0.5, character: 0 } } },
                { severity: 1, message: "Infinite", range: { start: { line: 0, character: Infinity } } },
              ],
            },
          },
        }}
        onFileOpen={() => {}}
        open
      />
    ))
    expect(screen.getByRole("region", { name: "Old content" })).toHaveTextContent("fallback old")
    expect(screen.queryByText("invalid patch")).not.toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Edit errors" })).not.toBeInTheDocument()
  })

  it("uses singular grammar for one replacement", () => {
    render(() => (
      <ToolDisplay
        tool={{
          ...tool("edit"),
          input: { path: "src/a.ts", oldString: "old", newString: "new", replaceAll: true },
          state: { type: "succeeded", result: { replacements: 1 } },
        }}
        onFileOpen={() => {}}
        open
      />
    ))
    expect(screen.getByText("1 replacement; the preview shows the replacement pattern once.")).toBeInTheDocument()
  })

  it("falls back on invalid dedicated input and labels non-success states honestly", () => {
    const invalid = render(() => <ToolDisplay tool={tool("write")} onFileOpen={() => {}} />)
    expect(screen.getByRole("button", { name: "Called write" })).toBeInTheDocument()
    invalid.unmount()
    const interrupted = render(() => (
      <ToolDisplay
        tool={{
          ...tool("edit"),
          input: { path: "a.ts", oldString: "a", newString: "b" },
          state: { type: "interrupted" },
        }}
        onFileOpen={() => {}}
      />
    ))
    expect(screen.getByRole("button", { name: /Edit interrupted a\.ts/ })).toBeInTheDocument()
    interrupted.unmount()
    render(() => (
      <ToolDisplay
        tool={{ ...tool("write"), input: { path: "a.ts", content: "a" }, state: { type: "stopped" } }}
        onFileOpen={() => {}}
      />
    ))
    expect(screen.getByRole("button", { name: /Write stopped a\.ts/ })).toBeInTheDocument()
  })
})
