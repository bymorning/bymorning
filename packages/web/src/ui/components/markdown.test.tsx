import { cleanup, render, screen, waitFor } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { createSignal } from "solid-js"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { sanitizeMarkdown } from "../markdown/markdown-cache"
import { createMarkdownParser } from "../markdown/markdown-parser"
import { project, type Projection } from "../markdown/markdown-stream"
import { injectMarkdownWorkerFactory } from "../markdown/markdown-worker"
import type { MarkdownWorkerRequest, MarkdownWorkerResponse } from "../markdown/markdown-worker-protocol"
import { Markdown } from "./markdown"

const { renderMermaidSvg } = vi.hoisted(() => ({
  renderMermaidSvg: vi.fn(() => Promise.resolve('<svg viewBox="0 0 10 10"><path d="M0 0" /></svg>')),
}))
vi.mock("../markdown/markdown-mermaid", () => ({ renderMermaidSvg }))

const parser = createMarkdownParser(
  (code, language) =>
    `<pre class="shiki ByMorning"><code class="language-${language}">${code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")}</code></pre>`,
)

class MarkdownWorker {
  static disposed: string[] = []
  onmessage: ((event: MessageEvent<MarkdownWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  private readonly projections = new Map<string, Projection>()

  postMessage(request: MarkdownWorkerRequest) {
    queueMicrotask(() => {
      if (request.type === "dispose") {
        MarkdownWorker.disposed.push(request.key)
        this.projections.delete(request.key)
        return
      }
      if (request.type === "parse") {
        void Promise.resolve(parser.parse(request.text)).then((html) =>
          this.send({ type: "parse", id: request.id, html }),
        )
        return
      }
      if (request.type === "project") {
        const projection = project(this.projections.get(request.key), request.text, request.live)
        this.projections.set(request.key, projection)
        this.send({ type: "project", id: request.id, key: request.key, projection })
        return
      }
      this.send({
        type: "highlight",
        id: request.id,
        key: request.key,
        language: request.language,
        reset: true,
        stable: [[request.text, ""]],
        unstable: [],
      })
    })
  }

  terminate() {}
  private send(response: MarkdownWorkerResponse) {
    this.onmessage?.(new MessageEvent("message", { data: response }))
  }
}

const clipboardProperty = Object.getOwnPropertyDescriptor(navigator, "clipboard")

beforeAll(() => injectMarkdownWorkerFactory(() => new MarkdownWorker()))
afterEach(() => {
  cleanup()
  renderMermaidSvg.mockClear()
  MarkdownWorker.disposed.length = 0
  vi.useRealTimers()
  if (clipboardProperty) {
    Object.defineProperty(navigator, "clipboard", clipboardProperty)
    return
  }
  Reflect.deleteProperty(navigator, "clipboard")
})

describe("Markdown", () => {
  it("notifies after asynchronous Markdown rendering completes", async () => {
    const [consumer, setConsumer] = createSignal(0)
    const rendered = vi.fn(() => {
      consumer()
      expect(screen.getByRole("heading", { name: "Complete" })).toBeInTheDocument()
    })
    render(() => <Markdown text="# Complete" cacheKey="notification" onContentRendered={rendered} />)

    expect(await screen.findByRole("heading", { name: "Complete" })).toBeInTheDocument()
    await waitFor(() => expect(rendered).toHaveBeenCalledTimes(1))

    setConsumer(1)
    await Promise.resolve()
    expect(rendered).toHaveBeenCalledTimes(1)
  })

  it("renders sanitized Markdown and decorates code blocks", async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    render(() => (
      <Markdown text={'# Heading\n\n<script>alert("x")</script>\n\n```ts\nconst x = 1\n```'} cacheKey="one" />
    ))

    expect(await screen.findByRole("heading", { name: "Heading" })).toBeInTheDocument()
    expect(document.querySelector("script")).not.toBeInTheDocument()
    const copy = await screen.findByRole("button", { name: "Copy code" })
    copy.click()
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("const x = 1"))
    await waitFor(() => expect(copy).toHaveAccessibleName("Code copied"))
    expect(document.querySelector('[data-markdown-ready=""]')).toBeInTheDocument()
  })

  it("resets each copy button independently", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(() => Promise.resolve()) },
    })
    render(() => <Markdown text={"```ts\none\n```\n\n```ts\ntwo\n```"} cacheKey="copy-resets" />)
    const buttons = await screen.findAllByRole("button", { name: "Copy code" })
    vi.useFakeTimers()

    buttons[0]!.click()
    await Promise.resolve()
    await Promise.resolve()
    vi.advanceTimersByTime(1000)
    buttons[1]!.click()
    await Promise.resolve()
    await Promise.resolve()
    vi.advanceTimersByTime(1000)

    expect(buttons[0]).toHaveAccessibleName("Copy code")
    expect(buttons[1]).toHaveAccessibleName("Code copied")
    vi.advanceTimersByTime(1000)
    expect(buttons[1]).toHaveAccessibleName("Copy code")
  })

  it("does not expose raw completed Markdown while parsing", async () => {
    const [text, setText] = createSignal("# First heading")
    const view = render(() => <Markdown text={text()} cacheKey="completed-pending" />)

    expect(view.container.querySelector('[data-component="markdown"]')).toBeEmptyDOMElement()
    expect(await screen.findByRole("heading", { name: "First heading" })).toBeInTheDocument()
    expect(view.container.querySelector('[data-markdown-ready=""]')).toBeInTheDocument()

    setText("## Second heading")
    expect(view.container).not.toHaveTextContent("## Second heading")
    expect(view.container.querySelector('[data-markdown-ready=""]')).not.toBeInTheDocument()
    expect(await screen.findByRole("heading", { name: "Second heading" })).toBeInTheDocument()
  })

  it("rejects a superseded render result", async () => {
    const [text, setText] = createSignal("# Superseded")
    render(() => <Markdown text={text()} cacheKey="superseded-result" />)

    setText("# Current")

    expect(await screen.findByRole("heading", { name: "Current" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Superseded" })).not.toBeInTheDocument()
  })

  it("updates a live incomplete code fence without replacing its block", async () => {
    const [text, setText] = createSignal("```ts\nconst one = 1")
    const view = render(() => <Markdown text={text()} cacheKey="live" streaming />)
    await waitFor(() => expect(view.container.querySelector("code")).toHaveTextContent("const one = 1"))
    const block = view.container.querySelector("[data-markdown-block]")

    setText((value) => `${value}\nconst two = 2`)
    await waitFor(() => expect(view.container.querySelector("code")).toHaveTextContent("const two = 2"))
    expect(view.container.querySelector("[data-markdown-block]")).toBe(block)
  })

  it("does not reuse a stale live projection after the source shrinks", async () => {
    const [text, setText] = createSignal("abcdef")
    const view = render(() => <Markdown text={text()} cacheKey="live-shrink" streaming />)
    await waitFor(() => expect(view.container).toHaveTextContent("abcdef"))

    setText("abc")

    expect(view.container).toHaveTextContent("abc")
    expect(view.container).not.toHaveTextContent("abcdef")
  })

  it("renders Mermaid code fences as diagrams", async () => {
    const view = render(() => <Markdown text={"```mermaid\ngraph TD\n  A --> B\n```"} cacheKey="mermaid" />)

    await waitFor(() => expect(view.container.querySelector('[data-component="markdown-mermaid"] svg')).toBeTruthy())
    expect(renderMermaidSvg).toHaveBeenCalledWith("graph TD\n  A --> B")
    expect(view.container.querySelector('[data-component="markdown-code"]')).toHaveAttribute(
      "data-mermaid-ready",
      "true",
    )
    expect(view.container.querySelector("pre")).toHaveTextContent("graph TD")
  })

  it("keeps the completed Mermaid render when a streaming render resolves later", async () => {
    const prefix = Promise.withResolvers<string>()
    const completed = Promise.withResolvers<string>()
    renderMermaidSvg.mockImplementationOnce(() => prefix.promise).mockImplementationOnce(() => completed.promise)
    const [text, setText] = createSignal("```mermaid\ngraph TD\n  A --> B\n  B -->")
    const view = render(() => <Markdown text={text()} cacheKey="mermaid-race" streaming />)
    await waitFor(() => expect(renderMermaidSvg).toHaveBeenCalledTimes(1))
    const wrapper = view.container.querySelector('[data-component="markdown-code"]')

    setText((value) => `${value} C\n\`\`\``)
    await waitFor(() => expect(renderMermaidSvg).toHaveBeenCalledTimes(2))
    expect(view.container.querySelector('[data-component="markdown-code"]')).toBe(wrapper)

    completed.resolve('<svg data-render="completed"></svg>')
    await waitFor(() => expect(wrapper?.querySelector('svg[data-render="completed"]')).toBeInTheDocument())
    prefix.resolve('<svg data-render="prefix"></svg>')
    await prefix.promise
    await Promise.resolve()

    expect(wrapper?.querySelector('svg[data-render="completed"]')).toBeInTheDocument()
    expect(wrapper?.querySelector('svg[data-render="prefix"]')).not.toBeInTheDocument()
    expect(wrapper).toHaveAttribute("data-mermaid-ready", "true")
  })

  it("renders completed Mermaid diagrams again after remounting from cache", async () => {
    const text = "```mermaid\nflowchart TD\n  A --> B\n```"
    const first = render(() => <Markdown text={text} cacheKey="mermaid-remount" />)
    await waitFor(() => expect(first.container.querySelector('[data-component="markdown-mermaid"] svg')).toBeTruthy())
    first.unmount()

    const second = render(() => <Markdown text={text} cacheKey="mermaid-remount" />)
    await waitFor(() => expect(second.container.querySelector('[data-component="markdown-mermaid"] svg')).toBeTruthy())
    expect(renderMermaidSvg).toHaveBeenCalledTimes(2)
  })

  it("clears copy reset timers when disposed", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(() => Promise.resolve()) },
    })
    const view = render(() => <Markdown text={"```ts\nconst value = 1\n```"} cacheKey="copy-cleanup" />)
    const copy = await screen.findByRole("button", { name: "Copy code" })
    vi.useFakeTimers()

    copy.click()
    await Promise.resolve()
    await Promise.resolve()
    expect(vi.getTimerCount()).toBe(1)
    view.unmount()

    expect(vi.getTimerCount()).toBe(0)
  })

  it("disposes its worker projection when unmounted", async () => {
    const view = render(() => <Markdown text="# Disposable" cacheKey="worker-cleanup" streaming />)
    expect(await screen.findByRole("heading", { name: "Disposable" })).toBeInTheDocument()

    view.unmount()

    await waitFor(() => expect(MarkdownWorker.disposed.length).toBeGreaterThan(0))
  })

  it("removes executable markup and unsafe links", () => {
    const html = sanitizeMarkdown(
      '<a href="javascript:alert(1)" target="_blank">bad</a><img src="x" onerror="alert(1)"><style>x{}</style>',
    )
    expect(html).not.toContain("javascript:")
    expect(html).not.toContain("onerror")
    expect(html).not.toContain("<style")
    expect(html).toContain('rel="noopener noreferrer"')
  })
})
