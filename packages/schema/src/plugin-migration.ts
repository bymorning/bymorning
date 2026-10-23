import { Schema } from "effect"

/** One retained definition's conversion outcome; this is migration evidence, not active Policy inventory. */
export const Conversion = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  status: Schema.Literals(["converted", "disabled", "unsupported", "invalid", "suppressed"]),
  message: Schema.String,
  rules: Schema.Array(Schema.Struct({
    index: Schema.Int,
    kind: Schema.String,
    status: Schema.Literals(["converted", "unwired", "unsupported"]),
    destination: Schema.String,
  })),
})
/** One retained definition's conversion outcome. */
export interface Conversion extends Schema.Schema.Type<typeof Conversion> {}

/** Administrator-only, lossless export of retained JSON and its conversion report. */
export const Archive = Schema.Struct({
  version: Schema.Literal(1),
  key: Schema.String,
  definitions: Schema.Array(Schema.Struct({ key: Schema.String, value: Schema.Json })),
  suppressions: Schema.Array(Schema.Struct({ key: Schema.String, value: Schema.Json })),
  report: Schema.Array(Conversion),
})
/** Administrator-only, lossless migration export. */
export interface Archive extends Schema.Schema.Type<typeof Archive> {}
