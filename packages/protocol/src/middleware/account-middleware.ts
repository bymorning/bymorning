import { AccountActor } from "@bymorning/schema/actor"
import { Auth } from "@bymorning/schema/auth"
import { Context } from "effect"
import { HttpApiMiddleware, HttpApiSecurity } from "effect/unstable/httpapi"
import { ServiceUnavailableError, UnauthorizedError } from "../errors.js"

/** Validated Account identity for the current browser request. */
export class CurrentAccount extends Context.Service<CurrentAccount, AccountActor>()(
  "@bymorning/protocol/CurrentAccount",
) {}

/**
 * The authenticated Login Session behind the current browser request. Undefined
 * only where an edge authenticates an Account without a cookie session.
 */
export const CurrentSession = Context.Reference<Auth.Session | undefined>("@bymorning/protocol/CurrentSession", {
  defaultValue: () => undefined,
})

/** Browser Account cookie declaration. */
export const accountCookieSecurity = HttpApiSecurity.apiKey({ in: "cookie", key: "__Host-bm_auth" })

/** Portable browser Account authentication contract. */
export class AccountMiddleware extends HttpApiMiddleware.Service<AccountMiddleware, { provides: CurrentAccount }>()(
  "@bymorning/protocol/AccountMiddleware",
  {
    security: { cookie: accountCookieSecurity },
    error: [UnauthorizedError, ServiceUnavailableError],
  },
) {}
