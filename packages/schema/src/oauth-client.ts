export * as OAuthClient from "./oauth-client.js"

import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { statics } from "./schema.js"

export const ID = Schema.String.check(Schema.isStartsWith("ocl_")).pipe(
  Schema.brand("OAuthClient.ID"),
  statics((schema) => ({ create: () => schema.make("ocl_" + ascending()) })),
)
export type ID = typeof ID.Type
