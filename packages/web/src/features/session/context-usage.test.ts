import { describe, expect, it } from "vitest"

import type { TranscriptEntry } from "../../context/session-state"
import type { ModelOption } from "../../utils/model-option"
import { contextUsage } from "./context-usage"

const tokens = (input: number, read = 0, output = 0) => ({
  input,
  output,
  reasoning: 0,
  cache: { read, write: 0 },
})
const assistant = (id: string, usage: ReturnType<typeof tokens>, model = { id: "sonnet", provider: "anthropic" }) =>
  ({
    message: { id, type: "assistant", model, time: { created: 0, completed: 1 }, usage: { cost: 0, tokens: usage } },
  }) as unknown as TranscriptEntry
const models = [
  { id: "sonnet", provider: "anthropic", limit: { context: 200_000 } },
  { id: "auto", provider: "auto", limit: {} },
] as unknown as ReadonlyArray<ModelOption>
const selected = { id: "sonnet", provider: "anthropic" } as ModelOption
const session = { cost: 1.5, costComplete: true, tokens: tokens(900_000, 900_000) } as never

describe("contextUsage", () => {
  it("measures the latest execution rather than cumulative Session usage", () => {
    const result = contextUsage({
      usage: session,
      model: selected,
      models,
      entries: [assistant("a", tokens(1_000, 0, 500)), assistant("b", tokens(2_000, 38_000, 1_000))],
    })
    expect(result).toEqual({ tokens: 41_000, cost: 1.5, costComplete: true, percentage: 21 })
  })

  it("skips executions without observed usage", () => {
    const result = contextUsage({
      usage: session,
      model: selected,
      models,
      entries: [assistant("a", tokens(20_000)), assistant("failed", tokens(0))],
    })
    expect(result.tokens).toBe(20_000)
  })

  it("resets at a completed compaction boundary", () => {
    const result = contextUsage({
      usage: session,
      model: selected,
      models,
      entries: [
        assistant("a", tokens(150_000)),
        { message: { id: "c", type: "compaction", status: "completed" } } as unknown as TranscriptEntry,
      ],
    })
    expect(result).toMatchObject({ tokens: 0, percentage: 0 })
  })

  it("uses the resolved Model limit when the selection is Auto", () => {
    const result = contextUsage({
      usage: session,
      model: { id: "auto", provider: "auto" } as ModelOption,
      models,
      entries: [assistant("a", tokens(100_000))],
    })
    expect(result.percentage).toBe(50)
  })

  it("omits the percentage when no limit is known", () => {
    const result = contextUsage({ usage: session, model: selected, models: undefined, entries: [] })
    expect(result).toEqual({ tokens: 0, cost: 1.5, costComplete: true })
  })
})
