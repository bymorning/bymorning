import { describe, expect, it } from "vitest"

import { createMarkdownParser } from "../src/markdown/markdown-parser.js"

describe("Markdown parser", () => {
  it("opens external links safely", async () => {
    const parser = createMarkdownParser(() => "")

    const html = await parser.parse('[guide](https://example.test "Guide")')

    expect(html).toContain(
      '<a href="https://example.test" title="Guide" target="_blank" rel="noopener noreferrer">guide</a>',
    )
  })

  it("renders math and delegates fence source unchanged to the highlighter", async () => {
    const highlight = (code: string, language: string) => `<pre data-language="${language}">${code}</pre>`
    const parser = createMarkdownParser(highlight)

    const html = await parser.parse("value \\(x^2\\)\n\n```ts\nconst value = 1\n```")

    expect(html).toContain('class="katex"')
    expect(html).toContain('<pre data-language="ts">const value = 1</pre>')
  })
})
