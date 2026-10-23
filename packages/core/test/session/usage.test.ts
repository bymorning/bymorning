import { Cost } from "@bymorning/schema/model"
import { empty } from "@bymorning/schema/usage"
import { describe, expect, it } from "vitest"
import { add, normalize } from "../../src/session/usage.js"

const usage = {
  inputTokens: 10,
  nonCachedInputTokens: 4,
  visibleOutputTokens: 3,
  reasoningTokens: 2,
  cacheReadInputTokens: 1,
  cacheWriteInputTokens: 0,
}

describe("Session usage pricing", () => {
  it("keeps a known subtotal and marks nonzero unknown dimensions incomplete", () => {
    expect(normalize(usage, Cost.make({ input: 2, cache: { read: 5 } }))).toMatchObject({
      cost: 13 / 1_000_000,
      costComplete: false,
      tokens: { input: 4, output: 3, reasoning: 2, cache: { read: 1, write: 0 } },
    })
  })

  it("does not make zero-token unknown dimensions incomplete", () => {
    expect(
      normalize(
        { ...usage, visibleOutputTokens: 0, reasoningTokens: 0, cacheWriteInputTokens: 0 },
        Cost.make({ input: 2, cache: { read: 5 } }),
      ).costComplete,
    ).toBe(true)
  })

  it("ANDs completeness while adding known subtotals", () => {
    const partial = normalize(usage, Cost.make({ input: 2, cache: { read: 5 } }))

    expect(add(empty, partial)).toMatchObject({ cost: partial.cost, costComplete: false })
  })
})
