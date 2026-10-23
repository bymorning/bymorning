import { describe, expect, it } from "vitest"

import { project, stream } from "./markdown-stream"

describe("stream", () => {
  it("returns a single live block for empty or whitespace-only text", () => {
    expect(stream("", true)).toEqual([{ raw: "", src: "", mode: "live" }])
    expect(stream("\n\n\n", true)).toEqual([{ raw: "\n\n\n", src: "\n\n\n", mode: "live" }])
  })

  it("returns a single full block for completed text", () => {
    expect(stream("# Done\n\ndetails", false)).toEqual([
      { raw: "# Done\n\ndetails", src: "# Done\n\ndetails", mode: "full" },
    ])
  })

  it("heals unfinished inline markdown in the live tail", () => {
    expect(stream("hello **world", true)).toEqual([{ raw: "hello **world", src: "hello **world**", mode: "live" }])
  })

  it("keeps link reference definitions in one live block instead of splitting them off", () => {
    expect(stream("[a]: http://x.com\n\nhello [a]", true)).toEqual([
      { raw: "[a]: http://x.com\n\nhello [a]", src: "[a]: http://x.com\n\nhello [a]", mode: "live" },
    ])
  })

  it("splits completed leading blocks from the live tail", () => {
    expect(stream("# A\n\nsome text", true)).toEqual([
      { raw: "# A\n\n", src: "# A\n\n", mode: "full" },
      { raw: "some text", src: "some text", mode: "live" },
    ])
    expect(stream("- one\n- two\n\nmore", true)).toEqual([
      { raw: "- one\n- two\n\n", src: "- one\n- two\n\n", mode: "full" },
      { raw: "more", src: "more", mode: "live" },
    ])
  })

  it("treats text ending in a blank line as one live tail block", () => {
    expect(stream("# A\n\n", true)).toEqual([{ raw: "# A\n\n", src: "# A\n\n", mode: "live" }])
  })

  it("treats a closed fence as a complete code block even while live", () => {
    expect(stream("```ts\nconst x = 1\n```", true)).toEqual([
      { raw: "```ts\nconst x = 1\n```", src: "const x = 1", mode: "code", language: "ts", complete: true },
    ])
    expect(stream("```\nconst x = 1\n```", true)).toEqual([
      { raw: "```\nconst x = 1\n```", src: "const x = 1", mode: "code", complete: true },
    ])
  })

  it("keeps an open fence incomplete and strips its info line", () => {
    expect(stream("```ts\nconst x = 1", true)).toEqual([
      { raw: "```ts\nconst x = 1", src: "const x = 1", mode: "code", language: "ts" },
    ])
    expect(stream("  ```js\nlet y", true)).toEqual([
      { raw: "  ```js\nlet y", src: "let y", mode: "code", language: "js" },
    ])
    expect(stream("~~~ts\nconst x", true)).toEqual([
      { raw: "~~~ts\nconst x", src: "const x", mode: "code", language: "ts" },
    ])
  })

  it("merges blank lines following a complete block into that block's raw text", () => {
    expect(stream("```ts\nconst x = 1\n```\n\ntrailing text", true)).toEqual([
      { raw: "```ts\nconst x = 1\n```\n\n", src: "const x = 1", mode: "code", language: "ts", complete: true },
      { raw: "trailing text", src: "trailing text", mode: "live" },
    ])
  })
})

describe("project", () => {
  it("completes unknown or non-live text as a single full block", () => {
    expect(project(undefined, "# Done", false)).toEqual({
      text: "# Done",
      blocks: [{ raw: "# Done", src: "# Done", mode: "full" }],
    })
  })

  it("finalizes a live prose tail once the text stops growing", () => {
    const live = project(undefined, "hello **wor", true)
    expect(live).toEqual({ text: "hello **wor", blocks: [{ raw: "hello **wor", src: "hello **wor**", mode: "live" }] })
    expect(project(live, "hello **wor", false)).toEqual({
      text: "hello **wor",
      blocks: [{ raw: "hello **wor", src: "hello **wor", mode: "full" }],
    })
    expect(project(live, "hello **world", false)).toEqual({
      text: "hello **world",
      blocks: [{ raw: "hello **world", src: "hello **world", mode: "full" }],
    })
  })

  it("marks an open fence complete when the projection finishes", () => {
    const open = project(undefined, "```ts\nconst a = 1", true)
    expect(project(open, "```ts\nconst a = 1", false)).toEqual({
      text: "```ts\nconst a = 1",
      blocks: [{ raw: "```ts\nconst a = 1", src: "const a = 1", mode: "code", language: "ts", complete: true }],
    })
  })

  it("appends a live suffix inside an open fence without re-streaming", () => {
    const open = project(undefined, "```ts\nconst a = 1", true)
    expect(project(open, "```ts\nconst a = 1\nconst b = 2", true)).toEqual({
      text: "```ts\nconst a = 1\nconst b = 2",
      blocks: [{ raw: "```ts\nconst a = 1\nconst b = 2", src: "const a = 1\nconst b = 2", mode: "code", language: "ts" }],
    })
  })

  it("re-streams when a live suffix closes the fence", () => {
    const open = project(undefined, "```ts\nconst a = 1", true)
    expect(project(open, "```ts\nconst a = 1\n```", true)).toEqual({
      text: "```ts\nconst a = 1\n```",
      blocks: [{ raw: "```ts\nconst a = 1\n```", src: "const a = 1", mode: "code", language: "ts", complete: true }],
    })
  })

  it("re-streams when the source shrinks below the previous projection", () => {
    const grown = project(undefined, "abcdef", true)
    expect(project(grown, "abc", true)).toEqual({
      text: "abc",
      blocks: [{ raw: "abc", src: "abc", mode: "live" }],
    })
  })
})
