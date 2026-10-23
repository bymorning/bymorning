import * as UsageSchema from "@bymorning/schema/usage"
import { MessageID, SessionID } from "@bymorning/schema/identifier"
import { Provider } from "@bymorning/schema/provider"
import { Schema } from "effect"
import { User } from "@bymorning/schema/user"
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

test("defines overview dimensions and derives a fully categorized total", () => {
  const aggregate = UsageSchema.Aggregate.make({
    invocations: 2,
    cost: 1.5,
    costComplete: false,
    tokens: { total: 15, input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
  })
  const overview = UsageSchema.Overview.make({
    days: UsageSchema.Days.make(1),
    from: new Date("2026-08-31T00:00:00.000Z"),
    to: new Date("2026-08-31T12:00:00.000Z"),
    total: aggregate,
    daily: [{ date: "2026-08-31", usage: aggregate }],
    users: [{ userID: User.ID.make("usr_usage"), usage: aggregate }],
    models: [{ model: "effective-model", usage: aggregate }],
  })

  expect(overview.total.tokens.total).toBe(15)
  expect(overview.total.costComplete).toBe(false)
  expect(() => UsageSchema.Days.make(0)).toThrow()
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

test("defines one completed execution usage record", () => {
  const info = UsageSchema.Info.make({
    id: MessageID.make("00000000-0000-4000-8000-000000000001"),
    sessionID: SessionID.make("00000000-0000-4000-8000-000000000002"),
    model: { id: "model", provider: Provider.Name.make("provider") },
    createdAt: new Date("2026-08-26T12:00:00.000Z"),
    usage: UsageSchema.empty,
  })

  expect(info.usage).toEqual(UsageSchema.empty)
})

test("defines one persisted provider usage record", () => {
  const record = UsageSchema.Record.make({
    id: UsageSchema.ID.make("00000000-0000-4000-8000-000000000003"),
    model: "effective-model",
    createdAt: new Date("2026-08-26T12:00:00.000Z"),
    usage: UsageSchema.empty,
  })

  expect(record).toMatchObject({ model: "effective-model", usage: UsageSchema.empty })
})

test("measures context occupancy from every token category except the provider total", () => {
  expect(
    UsageSchema.context({
      tokens: { total: 999, input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
    }),
  ).toBe(15)
  expect(UsageSchema.context(UsageSchema.empty)).toBe(0)
})
