export * as OAuthGrant from "./oauth-grant.js"

import { Schema } from "effect"
import { ascending } from "./identifier.js"
import * as OAuthClient from "./oauth-client.js"
import { statics } from "./schema.js"

export const ID = Schema.String.check(Schema.isStartsWith("ogr_")).pipe(
  Schema.brand("OAuthGrant.ID"),
  statics((schema) => ({ create: () => schema.make("ogr_" + ascending()) })),
)
export type ID = typeof ID.Type

/** Secret-free OAuth grant summary for self-service review. */
export const Info = Schema.Struct({
  id: ID,
  clientID: OAuthClient.ID,
  clientName: Schema.String,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  /** Absolute refresh-token expiry fixed at issuance; rotation does not extend it. */
  expiresAt: Schema.DateTimeUtc,
})
/** Secret-free OAuth grant summary for self-service review. */
export interface Info extends Schema.Schema.Type<typeof Info> {}
