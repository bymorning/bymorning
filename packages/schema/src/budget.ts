export * as Budget from "./budget.js"

import { Schema } from "effect"
import { NonNegativeInt } from "./schema.js"

/** Opaque key for anything whose inference spend is limited. Budget never parses it. */
export const Holder = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)).pipe(
  Schema.brand("Budget.Holder"),
)
export type Holder = typeof Holder.Type

/** USD, non-negative, finite. */
export const Amount = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
export type Amount = typeof Amount.Type

/** UTC calendar month with an exclusive upper boundary. */
export const Period = Schema.Struct({ start: Schema.Date, end: Schema.Date })
export interface Period extends Schema.Schema.Type<typeof Period> {}

/** One Holder's Spend Limit for every Period. */
export const Limit = Schema.Struct({ holder: Holder, amount: Amount })
export interface Limit extends Schema.Schema.Type<typeof Limit> {}

/** One Holder's current-Period position. */
export const Standing = Schema.Struct({
  holder: Holder,
  period: Period,
  spent: Amount,
  limit: Schema.optionalKey(Amount),
})
export interface Standing extends Schema.Schema.Type<typeof Standing> {}

/** A Spend Limit prevented admission. `retryAfter` is milliseconds until the Period ends. */
export class ExceededError extends Schema.TaggedError<ExceededError>()("Budget.ExceededError", {
  holder: Holder,
  retryAfter: NonNegativeInt,
}) {}

/** Budget persistence failed. */
export class StoreError extends Schema.TaggedError<StoreError>()("Budget.StoreError", {
  operation: Schema.Literals(["reserve", "settle", "limit", "status"]),
  cause: Schema.Defect(),
}) {}
