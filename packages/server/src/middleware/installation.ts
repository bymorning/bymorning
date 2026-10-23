import { Installation } from "@bymorning/core/installation"
import { ForbiddenError, ServiceUnavailableError } from "@bymorning/protocol/errors"
import { CurrentAccount } from "@bymorning/protocol/middleware/account-middleware"
import { Effect } from "effect"

/**
 * Require an authenticated Installation Admin before invoking an operation.
 * Installation Admin is not a Workspace Role: this reads the Account identity
 * established by cookie authentication, never a Workspace membership.
 */
export const requireInstallationAdmin = Effect.gen(function* () {
  const account = yield* CurrentAccount
  const installation = yield* Installation.Service
  const admin = yield* installation
    .check(account.properties.accountID)
    .pipe(
      Effect.catchDefect(() => Effect.fail(new ServiceUnavailableError({ message: "Installation is unavailable" }))),
    )
  if (!admin) return yield* new ForbiddenError({ message: "Installation administrator required" })
  return account
})
