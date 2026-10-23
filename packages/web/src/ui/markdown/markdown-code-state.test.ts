import { describe, expect, it } from "vitest"

import { shouldResetCodeTokens } from "./markdown-code-state"

const state = { language: "ts", generation: 1, stableCount: 3, raw: "const a", unstable: [] }

describe("shouldResetCodeTokens", () => {
  it("resets when there is no previous state", () => {
    expect(shouldResetCodeTokens(undefined, state)).toBe(true)
  })

  it("resets when the language or generation changes", () => {
    expect(shouldResetCodeTokens(state, { ...state, language: "js" })).toBe(true)
    expect(shouldResetCodeTokens(state, { ...state, generation: 2 })).toBe(true)
  })

  it("resets when stable tokens shrink or the raw text is not an extension", () => {
    expect(shouldResetCodeTokens(state, { ...state, stableCount: 2 })).toBe(true)
    expect(shouldResetCodeTokens(state, { ...state, raw: "const b" })).toBe(true)
  })

  it("continues when the next state extends the previous one", () => {
    expect(shouldResetCodeTokens(state, state)).toBe(false)
    expect(shouldResetCodeTokens(state, { ...state, stableCount: 4, raw: "const a = 1" })).toBe(false)
  })
})
