export * as ApiKey from "./api-key.js"

import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { optional, statics } from "./schema.js"
import * as ServiceAccount from "./service-account.js"
import * as Workspace from "./workspace.js"

export const ID = Schema.String.check(Schema.isStartsWith("apk_")).pipe(
  Schema.brand("ApiKey.ID"),
  statics((schema) => ({ create: () => schema.make("apk_" + ascending()) })),
)
export type ID = typeof ID.Type

/** A plaintext API key. Only its SHA-256 digest is persisted. */
export const Secret = Schema.String.check(Schema.isPattern(/^bm_[A-Za-z0-9_-]{43}$/)).pipe(
  Schema.brand("ApiKey.Secret"),
)
export type Secret = typeof Secret.Type

export const Info = Schema.Struct({
  id: ID,
  workspaceID: Workspace.ID,
  serviceAccountID: ServiceAccount.ID,
  name: Schema.String,
  prefix: Schema.String,
  timeExpires: optional(Schema.Date),
  timeUsed: optional(Schema.Date),
  timeCreated: Schema.Date,
  timeRevoked: optional(Schema.Date),
})
export interface Info extends Schema.Schema.Type<typeof Info> {}
