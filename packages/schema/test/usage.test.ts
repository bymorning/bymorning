import * as UsageSchema from "@bymorning/schema/usage"
import { Schema } from "effect"
import { UsageEvent } from "@bymorning/schema/usage-event"
import { SessionEvent } from "@bymorning/schema/session-event"
import { expect, test } from "vitest"

test("keeps usage observations out of the public Session inventory", () => {
  expect(SessionEvent.Definitions.map((definition) => definition.type)).not.toContain(UsageEvent.Observed.type)
})

test("accepts only finite non-negative Usage numbers and preserves an absent total", () => {
  const usage = Schema.decodeUnknownSync(UsageSchema.Usage)({
    cost: 0,
    tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
  })
  expect(usage.tokens).not.toHaveProperty("total")
  expect(usage.costComplete).toBe(true)
  expect(Schema.encodeSync(UsageSchema.Usage)(usage)).toHaveProperty("costComplete", true)
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY])
    expect(() => Schema.decodeUnknownSync(UsageSchema.Usage)({ ...usage, cost: value })).toThrow()
})

test("defaults legacy aggregates to complete", () => {
  expect(
    Schema.decodeUnknownSync(UsageSchema.Aggregate)({
      invocations: 0,
      cost: 0,
      tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }).costComplete,
  ).toBe(true)
})

test("measures context occupancy from every token category except the provider total", () => {
  expect(
    UsageSchema.context({
      tokens: { total: 999, input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
    }),
  ).toBe(15)
  expect(UsageSchema.context(UsageSchema.empty)).toBe(0)
})
