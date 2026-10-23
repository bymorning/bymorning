/** Declares the durable Tool Output contract owned by this module. */
export * as ToolOutput from "./tool-output.js"

import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { NonNegativeInt, optional, PositiveInt, statics } from "./schema.js"

const IDSchema = Schema.String.check(Schema.isStartsWith("out_")).pipe(Schema.brand("ToolOutput.ID"))

/** Opaque identifier for one stored Tool output. */
export const ID = IDSchema.pipe(
  statics((schema: typeof IDSchema) => ({
    create: () => schema.make("out_" + ascending()),
  })),
)
export type ID = typeof ID.Type

/** Pagination controls for stored UTF-8 Tool output. Cursors and limits are byte counts. */
export const ReadInput = Schema.Struct({
  cursor: NonNegativeInt.pipe(optional),
  limit: PositiveInt.pipe(optional),
})
export interface ReadInput extends Schema.Schema.Type<typeof ReadInput> {}

/** One UTF-8-safe page of stored Tool output. */
export const Page = Schema.Struct({
  content: Schema.String,
  cursor: NonNegativeInt,
  size: NonNegativeInt,
})
export interface Page extends Schema.Schema.Type<typeof Page> {}
