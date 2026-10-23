import { describe, expect, it } from "vitest"

import { referenceMention, stop, submit, type KeyInput } from "./interaction"

const key = (value: Partial<KeyInput>): KeyInput => ({
  key: "",
  ctrlKey: false,
  shiftKey: false,
  defaultPrevented: false,
  isComposing: false,
  ...value,
})

describe("composer keyboard interaction", () => {
  it("submits plain Enter but not Shift-Enter, composing Enter, or claimed events", () => {
    expect(submit(key({ key: "Enter" }))).toBe(true)
    expect(submit(key({ key: "Enter", shiftKey: true }))).toBe(false)
    expect(submit(key({ key: "Enter", isComposing: true }))).toBe(false)
    expect(submit(key({ key: "Enter", defaultPrevented: true }))).toBe(false)
  })
  it("stops on Escape and Ctrl-G only while active and unclaimed", () => {
    expect(stop(key({ key: "Escape" }), "stop")).toBe(true)
    expect(stop(key({ key: "g", ctrlKey: true }), "stop")).toBe(true)
    expect(stop(key({ key: "Escape" }), "submit")).toBe(false)
    expect(stop(key({ key: "Escape", defaultPrevented: true }), "stop")).toBe(false)
  })

  it("finds whitespace and punctuation-delimited project file mentions at the caret", () => {
    expect(referenceMention("open @src/fi later", 12, 12)).toEqual({ query: "src/fi", start: 5, end: 12 })
    expect(referenceMention("open (@src)", 10, 10)).toEqual({ query: "src", start: 6, end: 10 })
    expect(referenceMention("@packages/@scope/fi", 19, 19)).toEqual({
      query: "packages/@scope/fi",
      start: 0,
      end: 19,
    })
    expect(referenceMention('review @"my fi', 14, 14)).toEqual({ query: "my fi", start: 7, end: 14 })
    expect(referenceMention("mail user@example.com", 21, 21)).toBeUndefined()
    expect(referenceMention("@src", 2, 3)).toBeUndefined()
  })
})
