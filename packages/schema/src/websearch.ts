export * as WebSearch from "./websearch.js"

import { Schema } from "effect"
import { Event as EventSchema } from "./event.js"
import { optional } from "./schema.js"

/** Registered web-search capability identifier. */
export const ID = Schema.String.pipe(Schema.brand("WebSearch.ID"))

/** Registered web-search capability identifier. */
export type ID = typeof ID.Type

/** Public web-search capability catalog entry. */
export const Provider = Schema.Struct({
  id: ID,
  name: Schema.String,
}).annotate({ identifier: "WebSearch.Provider" })

/** Public web-search capability catalog entry. */
export interface Provider extends Schema.Schema.Type<typeof Provider> {}

export interface Input extends Schema.Schema.Type<typeof Input> {}
export const Input = Schema.Struct({
  query: Schema.String,
  providerID: ID.pipe(optional),
}).annotate({ identifier: "WebSearch.Input" })
export type ProviderInput = Pick<Input, "query">

export interface Result extends Schema.Schema.Type<typeof Result> {}
export const Result = Schema.Struct({
  url: Schema.String,
  title: Schema.String.pipe(optional),
  content: Schema.String.pipe(optional),
  time: Schema.Struct({ published: Schema.Finite.pipe(optional) }),
}).annotate({ identifier: "WebSearch.Result" })

export class Response extends Schema.Class<Response>("WebSearch.Response")({
  providerID: ID,
  results: Schema.Array(Result),
}) {}

const Updated = EventSchema.define("websearch.updated", {})
export const Event = { Updated, Definitions: EventSchema.inventory(Updated) }
