import { describe, expect, it } from "vitest"
import { Wildcard } from "../src/wildcard.js"

describe("Wildcard", () => {
  it("matches stars and single-character wildcards", () => {
    expect(Wildcard.match("model.request", "model.*")).toBe(true)
    expect(Wildcard.match("tool-a", "tool-?")).toBe(true)
    expect(Wildcard.match("tool-aa", "tool-?")).toBe(false)
  })

  it("treats regex syntax literally and normalizes path separators", () => {
    expect(Wildcard.match("a+b", "a+b")).toBe(true)
    expect(Wildcard.match("a/b/c", "a\\b/*")).toBe(true)
  })

  it("retains the optional command-arguments permission behavior", () => {
    expect(Wildcard.match("git", "git *")).toBe(true)
    expect(Wildcard.match("git status", "git *")).toBe(true)
  })
})
