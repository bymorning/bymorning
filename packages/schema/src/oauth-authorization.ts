export * as OAuthAuthorization from "./oauth-authorization.js"

import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { statics } from "./schema.js"

export const ID = Schema.String.check(Schema.isStartsWith("oau_")).pipe(
  Schema.brand("OAuthAuthorization.ID"),
  statics((schema) => ({ create: () => schema.make("oau_" + ascending()) })),
)
export type ID = typeof ID.Type
