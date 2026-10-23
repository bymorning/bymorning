export * as Money from "./money.js"

import { Schema } from "effect"
import { statics } from "./schema.js"

const DecimalAmount = Schema.String.check(Schema.isPattern(/^(?:0|[1-9]\d*)(?:\.\d+)?$/))

/** Exact non-negative USD amount encoded without floating-point loss. */
export const USD = DecimalAmount.pipe(
  Schema.brand("Money.USD"),
  Schema.annotate({ identifier: "Money.USD" }),
  statics((schema) => ({ zero: schema.make("0") })),
)

/** Exact non-negative USD amount encoded without floating-point loss. */
export type USD = typeof USD.Type

/** Exact non-negative USD price per million tokens. */
export const USDPerMillionTokens = USD.pipe(
  Schema.brand("Money.USDPerMillionTokens"),
  Schema.annotate({ identifier: "Money.USDPerMillionTokens" }),
  statics((schema) => ({ zero: schema.make("0") })),
)

/** Exact non-negative USD price per million tokens. */
export type USDPerMillionTokens = typeof USDPerMillionTokens.Type
