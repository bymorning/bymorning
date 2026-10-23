export * as AccountProfile from "./account-profile.js"

import { Schema } from "effect"
import * as Account from "./account.js"
import * as Auth from "./auth.js"

/** Public display information for the authenticated Account. */
export const Info = Schema.Struct({
  id: Account.ID,
  email: Schema.NullOr(Auth.Email),
})

/** Public display information for the authenticated Account. */
export interface Info extends Schema.Schema.Type<typeof Info> {}
