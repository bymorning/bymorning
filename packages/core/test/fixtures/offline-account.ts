import { AccountProfile } from "@bymorning/schema/account-profile"
import { Effect } from "effect"
import { Account } from "../../src/account.js"
import { Auth } from "../../src/auth.js"

/** An Account authority for MCP scenarios; `email` answers `${member.email}`. */
export const offlineAccount = (email: string | null = null): Account.Interface => ({
  get: (actor) =>
    Effect.succeed(
      AccountProfile.Info.make({
        id: actor.properties.accountID,
        email: email === null ? null : Auth.Email.make(email),
      }),
    ),
  validate: (actor) => Effect.succeed(actor),
  suspend: (accountID) => Effect.fail(new Account.NotFoundError({ accountID })),
  restore: (accountID) => Effect.fail(new Account.NotFoundError({ accountID })),
})
