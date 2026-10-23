export * as ServiceAccount from "./service-account.js"

import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { NonNegativeInt, optional, statics } from "./schema.js"
import * as Workspace from "./workspace.js"

export const ID = Schema.String.check(Schema.isStartsWith("sva_")).pipe(
  Schema.brand("ServiceAccount.ID"),
  statics((schema) => ({ create: () => schema.make("sva_" + ascending()) })),
)
export type ID = typeof ID.Type

export const Status = Schema.Literals(["active", "suspended"])
export type Status = typeof Status.Type

export const Policy = Schema.Struct({
  models: optional(Schema.Array(Schema.String)),
  rpm: optional(Schema.Number),
  tpm: optional(Schema.Number),
})
export interface Policy extends Schema.Schema.Type<typeof Policy> {}

export const Info = Schema.Struct({
  id: ID,
  workspaceID: Workspace.ID,
  name: Schema.String,
  status: Status,
  policy: Policy,
  timeCreated: Schema.Date,
  timeUpdated: Schema.Date,
})
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const Summary = Schema.Struct({
  ...Info.fields,
  keyCount: NonNegativeInt,
})
export interface Summary extends Schema.Schema.Type<typeof Summary> {}
