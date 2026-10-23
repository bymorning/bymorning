import * as Account from "@bymorning/schema/account"
import { AccountProfile } from "@bymorning/schema/account-profile"
import { Auth } from "@bymorning/schema/auth"
import { OAuthClient } from "@bymorning/schema/oauth-client"
import { OAuthGrant } from "@bymorning/schema/oauth-grant"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"
import {
  ForbiddenError,
  InputError,
  InternalError,
  LoginSessionNotFoundError,
  OAuthGrantNotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
} from "../errors.js"

/**
 * Transport projection of `Auth.LoginInfo`. Instants travel as ISO 8601
 * strings; `current` marks the session whose cookie carries this very request.
 */
export const SessionInfo = Schema.Struct({
  id: Auth.SessionID,
  createdAt: Schema.String,
  activeAt: Schema.String,
  idleUntil: Schema.String,
  expiresAt: Schema.String,
  current: Schema.Boolean,
}).annotate({ identifier: "Account.SessionInfo" })
export type SessionInfo = typeof SessionInfo.Type

/** Transport projection of `OAuthGrant.Info`. Instants travel as ISO 8601 strings. */
export const GrantInfo = Schema.Struct({
  id: OAuthGrant.ID,
  clientID: OAuthClient.ID,
  clientName: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  expiresAt: Schema.String,
}).annotate({ identifier: "Account.GrantInfo" })
export type GrantInfo = typeof GrantInfo.Type

/** Cookie-authenticated access to the current Account, self-service sessions and grants, and Installation Admin lifecycle operations. */
export const AccountGroup = HttpApiGroup.make("api.account")
  .add(
    HttpApiEndpoint.get("account.get", "/account", {
      success: AccountProfile.Info,
      error: [UnauthorizedError, ServiceUnavailableError],
    }),
  )
  .add(
    HttpApiEndpoint.get("account.session.list", "/account/sessions", {
      success: Schema.Array(SessionInfo),
      error: [UnauthorizedError, ServiceUnavailableError],
    }),
  )
  .add(
    HttpApiEndpoint.delete("account.session.revoke", "/account/sessions/:sessionID", {
      params: { sessionID: Auth.SessionID },
      success: Schema.Void.pipe(HttpApiSchema.status(204)),
      error: [UnauthorizedError, ForbiddenError, ServiceUnavailableError, LoginSessionNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.get("account.grant.list", "/account/grants", {
      success: Schema.Array(GrantInfo),
      error: [UnauthorizedError, ServiceUnavailableError],
    }),
  )
  .add(
    HttpApiEndpoint.delete("account.grant.revoke", "/account/grants/:grantID", {
      params: { grantID: OAuthGrant.ID },
      success: Schema.Void.pipe(HttpApiSchema.status(204)),
      error: [UnauthorizedError, ForbiddenError, ServiceUnavailableError, OAuthGrantNotFoundError],
    }),
  )
  .add(
    HttpApiEndpoint.post("account.suspend", "/accounts/:accountID/suspend", {
      params: { accountID: Account.ID },
      success: Schema.Void.pipe(HttpApiSchema.status(204)),
      error: [ForbiddenError, InputError, ServiceUnavailableError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.post("account.restore", "/accounts/:accountID/restore", {
      params: { accountID: Account.ID },
      success: Schema.Void.pipe(HttpApiSchema.status(204)),
      error: [ForbiddenError, InputError, ServiceUnavailableError, InternalError],
    }),
  )
  .prefix("/api")
