import { cleanup, render, screen } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { createRoot, createSignal } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createPacedValue, PacedMarkdown } from "./paced-markdown"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("PacedMarkdown", () => {
  it("shows Markdown source as plain text without creating a Markdown renderer", async () => {
    const rendered = vi.fn()
    const [text, setText] = createSignal("# Heading\n\n**Bold** and [link](https://example.com)")
    const view = render(() => (
      <PacedMarkdown
        text={text()}
        cacheKey="raw"
        streaming={false}
        renderMarkdown={false}
        onContentRendered={rendered}
      />
    ))

    expect(screen.queryByRole("heading")).not.toBeInTheDocument()
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
    expect(view.container.querySelector('[data-component="markdown"]')).not.toBeInTheDocument()
    expect(view.container.querySelector('[data-component="raw-text"]')).toHaveTextContent(
      "# Heading **Bold** and [link](https://example.com)",
    )
    expect(rendered).toHaveBeenCalledTimes(1)

    setText("`literal`")
    await Promise.resolve()
    expect(view.container.querySelector('[data-component="raw-text"]')).toHaveTextContent("`literal`")
    expect(rendered).toHaveBeenCalledTimes(2)
  })

  it("snaps queued text to the full current value when cancelling disables pacing", async () => {
    vi.useFakeTimers()
    const [text, setText] = createSignal("prefix")
    const [streaming, setStreaming] = createSignal(true)
    const full = `prefix ${"streaming text ".repeat(80)}`
    const dispose = createRoot((dispose) => {
      const rendered = createPacedValue(text, streaming)
      return { dispose, rendered }
    })

    setText(full)
    await Promise.resolve()
    expect(dispose.rendered()).toBe("prefix")

    setStreaming(false)
    await Promise.resolve()
    expect(dispose.rendered()).toBe(full)
    dispose.dispose()
  })

  it("snaps a large buffered burst instead of scheduling many stale intermediate renders", async () => {
    vi.useFakeTimers()
    const [text, setText] = createSignal("prefix")
    const dispose = createRoot((dispose) => ({ dispose, rendered: createPacedValue(text, () => true) }))
    const full = `prefix ${"abcdefgh".repeat(1_000)}`

    setText(full)
    await Promise.resolve()

    expect(dispose.rendered()).toBe(full)
    expect(vi.getTimerCount()).toBe(0)
    dispose.dispose()
  })
})
