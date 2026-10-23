export * as ConfigGateway from "./gateway.js"

import { Schema } from "effect"
import { NonNegativeInt, optional } from "../schema.js"

export const Limits = Schema.Struct({
  rpm: NonNegativeInt.pipe(optional),
  tpm: NonNegativeInt.pipe(optional),
})
export interface Limits extends Schema.Schema.Type<typeof Limits> {}

/** Optional Workspace-wide activity caps for inference admission. Spend Limits belong to Budget. */
export const Info = Schema.Struct({
  limits: Limits.pipe(optional),
  models: Schema.Array(Schema.String).pipe(optional),
})
export interface Info extends Schema.Schema.Type<typeof Info> {}
