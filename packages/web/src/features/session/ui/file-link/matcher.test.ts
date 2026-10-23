import { describe, expect, it } from "vitest"

import { fileMatches } from "./matcher"

describe("FileLink matching", () => {
  const paths = ["src/app.ts", "README.md", "notes/readme.md"]

  it("matches complete, case-sensitive Project-relative prose paths", () => {
    expect(fileMatches("Read src/app.ts and README.md.", paths, "markdown")).toEqual([
      { start: 5, end: 15, path: "src/app.ts" },
      { start: 20, end: 29, path: "README.md" },
    ])
    expect(fileMatches("read src/App.ts or app.ts", paths, "markdown")).toEqual([])
  })

  it("does not infer basenames or decorate an incomplete token", () => {
    expect(fileMatches("Use app.ts and notes/readme", paths, "markdown")).toEqual([])
  })

  it("recognizes only explicit user references", () => {
    expect(fileMatches("Use @src/app.ts, not src/app.ts", paths, "user")).toEqual([
      { start: 5, end: 15, path: "src/app.ts" },
    ])
  })
})
