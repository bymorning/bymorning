import { describe, expect, it } from "vitest"

import { createMarkdownParser } from "./markdown-parser"

const calls: Array<[code: string, language: string]> = []
const parser = createMarkdownParser((code, language) => {
  calls.push([code, language])
  return `<pre data-lang="${language}">${code}</pre>`
})

describe("createMarkdownParser", () => {
  it("renders headings and inline emphasis", async () => {
    const html = await parser.parse("# Title\n\nsome **bold** text")
    expect(html).toContain("<h1>Title</h1>")
    expect(html).toContain("<p>some <strong>bold</strong> text</p>")
  })

  it("renders single newlines as line breaks without affecting lists", async () => {
    const html = await parser.parse("1 — start\n2 — pair\n\n- one\n- two")
    expect(html).toContain("<p>1 — start<br>2 — pair</p>")
    expect(html).toContain("<li>one</li>")
    expect(html).not.toContain("<li>one<br>")
  })

  it("renders lists and tables", async () => {
    const html = await parser.parse("- one\n- two\n\n| a | b |\n| --- | --- |\n| 1 | 2 |")
    expect(html).toContain("<li>one</li>")
    expect(html).toContain("<li>two</li>")
    expect(html).toContain("<th>a</th>")
    expect(html).toContain("<td>1</td>")
  })

  it("forces links to open in a new tab with noopener and noreferrer", async () => {
    const html = await parser.parse('[by](https://x.y "The Title")')
    expect(html).toContain('<a href="https://x.y" title="The Title" target="_blank" rel="noopener noreferrer">by</a>')
  })

  it("passes raw code and language to the highlighter and embeds its output verbatim", async () => {
    const html = await parser.parse('```ts\nconst a = "x" & <b>\n```')
    expect(calls[calls.length - 1]).toEqual(['const a = "x" & <b>', "ts"])
    expect(html).toContain('<pre data-lang="ts">const a = "x" & <b></pre>')
  })

  it("highlights fences without a language as empty language", async () => {
    const html = await parser.parse("```\nplain\n```")
    expect(calls[calls.length - 1]).toEqual(["plain", ""])
    expect(html).toContain('<pre data-lang="">plain</pre>')
  })

  it("renders inline math with KaTeX", async () => {
    const html = await parser.parse("value \\(x^2\\) end")
    expect(html).toContain('class="katex"')
    expect(html).toContain('<annotation encoding="application/x-tex">x^2</annotation>')
  })

  it("renders block math in display mode", async () => {
    const html = await parser.parse("$$\nE = mc^2\n$$")
    expect(html).toContain('<span class="katex-display">')
    expect(html).toContain('<annotation encoding="application/x-tex">E = mc^2</annotation>')
  })
})
