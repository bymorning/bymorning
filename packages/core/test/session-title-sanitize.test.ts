import { describe, expect, it } from "vitest"
import { fallbackTitle, sanitizeTitle } from "../src/session/title/sanitize.js"

describe("sanitizeTitle", () => {
  it.each([
    ["**Image and CSV Description Request**", "Image and CSV Description Request"],
    ["Title: Compute 2**64 Result", "Compute 2**64 Result"],
    ["# Lemon Essay", "Lemon Essay"],
    ['"Quoted Title."', "Quoted Title"],
    ["**Title:** Bold Label", "Bold Label"],
    ["Title: **Both**", "Both"],
    ["`code title`", "code title"],
    ["\n  Plain title  \nextra line", "Plain title"],
    ["Preserve file_name.py", "Preserve file_name.py"],
    ["Reply with banana", "Reply with banana"],
    ["Is 2*3 six?", "Is 2*3 six?"],
    ["**Hello** `world`", "Hello world"],
    ["Fix `foo_bar` and *this* bug", "Fix foo_bar and this bug"],
    ["```mermaid\ngraph TD\n```\nDiagram Request", "Diagram Request"],
    ["~~~js\nconst a = 1\n~~~\n\nTitle: Script Help", "Script Help"],
  ])("%j -> %j", (raw, expected) => {
    expect(sanitizeTitle(raw)).toBe(expected)
  })

  it.each(["", "   \n ", "**", "Title:", '""', "```mermaid", "```js\nconst a = 1\n```", "~~~\ncode"])(
    "rejects empty result for %j",
    (raw) => {
      expect(sanitizeTitle(raw)).toBeUndefined()
    },
  )
})

describe("fallbackTitle", () => {
  it.each([
    [
      "Draw a mermaid flowchart A->B->C in a mermaid code block. No other text.",
      "Draw a mermaid flowchart A->B->C in a mermaid",
    ],
    ["\n\n  **Fix** the   login   bug  \nmore", "Fix the login bug"],
    ["```js\nconst a = 1\n```\nExplain this snippet", "Explain this snippet"],
    ["# Heading request.", "Heading request"],
  ])("%j -> %j", (raw, expected) => {
    expect(fallbackTitle(raw)).toBe(expected)
  })

  it.each(["", "  \n ", "```js\nconst a = 1\n```"])("returns undefined for %j", (raw) => {
    expect(fallbackTitle(raw)).toBeUndefined()
  })
})
