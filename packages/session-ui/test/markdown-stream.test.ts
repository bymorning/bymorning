import { describe, expect, it } from "vitest"

import { canReusePendingBlock } from "../src/markdown/markdown-projection.js"
import { project, stream } from "../src/markdown/markdown-stream.js"

describe("streaming markdown projection", () => {
  it("keeps completed blocks stable while healing only the streaming tail", () => {
    const blocks = stream("# Heading\n\n[unfinished", true)

    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ mode: "full", raw: "# Heading\n\n" })
    expect(blocks[1]).toMatchObject({ mode: "live", raw: "[unfinished" })
    expect(blocks[1]?.src).toBe("unfinished")
  })

  it("holds reference definitions in the live tail until the stream completes", () => {
    expect(stream("[a]: https://example.test\n\nUse [a]", true)).toEqual([
      { raw: "[a]: https://example.test\n\nUse [a]", src: "[a]: https://example.test\n\nUse [a]", mode: "live" },
    ])
  })

  it("extends an open code fence without replacing its existing block", () => {
    const first = project(undefined, "Before\n\n```ts\nconst value =", true)
    const second = project(first, "Before\n\n```ts\nconst value = 1", true)

    expect(first.blocks).toHaveLength(2)
    expect(second.blocks).toHaveLength(2)
    expect(second.blocks[1]).toMatchObject({ mode: "code", language: "ts" })
    expect(second.blocks[1]?.complete).toBeUndefined()
    expect(second.blocks[1]?.raw).toBe("```ts\nconst value = 1")
    expect(canReusePendingBlock(first.blocks[1], second.blocks[1]!)).toBe(true)
  })

  it("finalizes an unfinished streamed block on completion", () => {
    const pending = project(undefined, "A [reference", true)
    const done = project(pending, "A [reference](https://example.test)", false)

    expect(done.text).toBe("A [reference](https://example.test)")
    expect(done.blocks).toEqual([{ raw: done.text, src: done.text, mode: "full" }])
  })

  it("does not reuse an unrelated block after a replacement", () => {
    const initial = project(undefined, "first", true)
    const replacement = project(initial, "second", true)

    expect(replacement.blocks).not.toBe(initial.blocks)
    expect(replacement.blocks[0]?.raw).toBe("second")
  })

  it("marks a closed fence complete and keeps the language-free code body clean", () => {
    expect(stream("```\nconst x = 1\n```", true)).toEqual([
      { raw: "```\nconst x = 1\n```", src: "const x = 1", mode: "code", complete: true },
    ])
  })
})
