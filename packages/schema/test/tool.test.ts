import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { Tool } from "../src/tool.js"

describe("Tool", () => {
  it("decodes only pinned inline and Project File sandbox implementations", () => {
    const decode = Schema.decodeUnknownSync(Tool.Implementation)

    expect(decode({ type: "inline", language: "python", body: "return {}" })).toEqual({
      type: "inline",
      language: "python",
      body: "return {}",
    })
    expect(decode({ type: "project-file", path: "scripts/tool.ts" })).toEqual({
      type: "project-file",
      path: "scripts/tool.ts",
    })
    expect(() => decode({ type: "inline", language: "ruby", body: "{}" })).toThrow()
    expect(() => decode({ type: "project-file", path: "../tool.ts" })).toThrow()
  })
})
