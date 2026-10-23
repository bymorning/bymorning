/** Declares the Tool Output Config contract owned by this module. */
export * as ConfigToolOutput from "./tool-output.js"

import { Effect, Schema } from "effect"
import { PositiveInt } from "../schema.js"

/** Defaults used to bound Tool output returned to a model. */
export const defaults = { max_lines: 2_000, max_bytes: 50 * 1_024 } as const

// These minima fit every UTF-8 scalar, including a newline under split-line accounting.
const MaxLines = PositiveInt.check(Schema.isGreaterThanOrEqualTo(2))
const MaxBytes = PositiveInt.check(Schema.isGreaterThanOrEqualTo(4))

/** Tool Output limits accepting sparse encoded fields and decoding all runtime defaults. */
export const Info = Schema.Struct({
  max_lines: MaxLines.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(defaults.max_lines))),
  max_bytes: MaxBytes.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(defaults.max_bytes))),
})

/** Fully resolved Tool Output runtime Config. */
export interface Info extends Schema.Schema.Type<typeof Info> {}
