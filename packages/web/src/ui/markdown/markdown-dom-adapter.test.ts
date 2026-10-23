import "@testing-library/jest-dom/vitest"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createMarkdownDomAdapter, limitMermaidScale, mermaidMinScale } from "./markdown-dom-adapter"

vi.mock("./markdown-mermaid", () => ({ renderMermaidSvg: vi.fn(() => Promise.resolve(undefined)) }))

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
})

describe("limitMermaidScale", () => {
  it("floors the rendered width at a legible fraction of the natural width", () => {
    const diagram = document.createElement("div")
    diagram.innerHTML = '<svg viewBox="0 0 1600 200" width="100%"></svg>'
    limitMermaidScale(diagram)
    expect(diagram.querySelector("svg")?.style.minWidth).toBe(`${Math.round(1600 * mermaidMinScale)}px`)
  })

  it("leaves diagrams without a usable viewBox alone", () => {
    const diagram = document.createElement("div")
    diagram.innerHTML = "<svg></svg>"
    limitMermaidScale(diagram)
    expect(diagram.querySelector("svg")?.style.minWidth).toBe("")
  })
})

describe("Markdown DOM adapter", () => {
  it("preserves stable streaming token nodes while replacing the unstable tail", () => {
    const root = document.createElement("div")
    const adapter = createMarkdownDomAdapter(root)
    adapter.update([
      {
        key: "code",
        mode: "code",
        raw: "const",
        hash: "5",
        language: "ts",
        complete: false,
        generation: 1,
        stable: [],
        unstable: [["const", "color:red"]],
      },
    ])
    const stable = root.querySelector("span")

    adapter.update([
      {
        key: "code",
        mode: "code",
        raw: "const value",
        hash: "11",
        language: "ts",
        complete: false,
        generation: 1,
        stable: [["const", "color:red"]],
        unstable: [[" value", "color:blue"]],
      },
    ])

    expect(root.querySelectorAll("span")[0]).toBe(stable)
    expect(root.querySelector("code")).toHaveTextContent("const value")
    adapter.dispose()
  })

  it("labels streaming code blocks with their language", () => {
    const root = document.createElement("div")
    const adapter = createMarkdownDomAdapter(root)
    adapter.update([
      {
        key: "code",
        mode: "code",
        raw: "x",
        hash: "1",
        language: "python",
        complete: true,
        generation: 1,
        stable: [],
        unstable: [["x", ""]],
      },
    ])
    expect(root.querySelector('[data-component="markdown-code"]')).toHaveAttribute("data-language", "python")
    adapter.dispose()
  })

  it("labels settled code blocks and keeps copy feedback across re-renders", () => {
    const root = document.createElement("div")
    const adapter = createMarkdownDomAdapter(root)
    const html = '<pre class="shiki"><code class="language-ts">a</code></pre><p>one</p>'
    adapter.update([{ key: "k", mode: "full", raw: "a", hash: "1", html }])
    expect(root.querySelector('[data-component="markdown-code"]')).toHaveAttribute("data-language", "ts")
    const button = root.querySelector('[data-slot="markdown-copy-button"]')!
    button.textContent = "Copied"
    adapter.update([{ key: "k", mode: "full", raw: "a2", hash: "2", html: html.replace("one", "two") }])
    expect(root.querySelector('[data-slot="markdown-copy-button"]')).toHaveTextContent("Copied")
    adapter.dispose()
  })
})
