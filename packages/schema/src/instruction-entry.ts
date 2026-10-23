/** Declares API-managed Session Instruction Entry schemas. */
export * as InstructionEntry from "./instruction-entry.js"
export * as InstructionEntrySchema from "./instruction-entry.js"

import { Schema } from "effect"

/** Slash-free key whose Instruction source is namespaced under `api/`. */
export const Key = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]*$/)).annotate({
  identifier: "InstructionEntry.Key",
  description: "Instruction entry key (lowercase alphanumerics plus . _ -)",
})
export type Key = typeof Key.Type

export const Info = Schema.Struct({
  key: Key,
  value: Schema.Json.annotate({ description: "JSON value attached to the session's instructions" }),
}).annotate({ identifier: "InstructionEntry.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const MaxBytes = 8 * 1024

/** The encoded JSON value exceeds the per-entry limit. */
export class SizeError extends Schema.TaggedError<SizeError>()(
  "InstructionEntry.SizeError",
  { actualBytes: Schema.Int, maxBytes: Schema.Int, message: Schema.String },
  { httpApiStatus: 413 },
) {}
