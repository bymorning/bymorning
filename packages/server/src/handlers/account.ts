import { Account } from "@bymorning/core/account"
import { Auth } from "@bymorning/core/auth"
import { Audit } from "@bymorning/core/audit"
import { OAuth } from "@bymorning/core/oauth"
import {
  InputError,
  LoginSessionNotFoundError,
  OAuthGrantNotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
} from "@bymorning/protocol/errors"
import { CurrentAccount, CurrentSession } from "@bymorning/protocol/middleware/account-middleware"
import { DateTime, Effect } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api.js"
import { validateOrigin } from "../middleware/auth.js"
import { audited } from "../middleware/audit.js"
import { requireInstallationAdmin } from "../middleware/installation.js"

const unavailable = () => new ServiceUnavailableError({ message: "Account is unavailable" })

/**
 * Project the Account established by cookie authentication, without workspace
 * selection. Unsafe self-service revocations validate the Origin like every
 * other cookie-authenticated mutation. Lifecycle operations require the
 * Installation Admin.
 */
export const AccountHandler = (appOrigin: string) =>
  HttpApiBuilder.group(Api, "api.account", (handlers) =>
    handlers
      .handle(
        "account.get",
        Effect.fn("AccountHandler.get")(function* () {
          const actor = yield* CurrentAccount
          const accounts = yield* Account.Service
          const profile = yield* accounts.get(actor).pipe(
            Effect.catchTags({
              "Account.UnavailableError": () =>
                Effect.fail(new UnauthorizedError({ message: "Authentication required" })),
              "Account.ReadError": () => Effect.fail(unavailable()),
            }),
          )
          return HttpServerResponse.jsonUnsafe(profile, { headers: { "cache-control": "no-store" } })
        }),
      )
      .handle(
        "account.session.list",
        Effect.fn("AccountHandler.sessionList")(function* () {
          const actor = yield* CurrentAccount
          const current = yield* CurrentSession
          const auth = yield* Auth.Service
          const sessions = yield* auth.list(actor).pipe(
            Effect.mapError(unavailable),
            Effect.catchDefect(() => Effect.fail(unavailable())),
          )
          return sessions.map((session) => ({
            id: session.id,
            createdAt: DateTime.formatIso(session.createdAt),
            activeAt: DateTime.formatIso(session.activeAt),
            idleUntil: DateTime.formatIso(session.idleUntil),
            expiresAt: DateTime.formatIso(session.expiresAt),
            current: current?.id === session.id,
          }))
        }),
      )
      .handle(
        "account.session.revoke",
        Effect.fn("AccountHandler.sessionRevoke")(function* ({ params }) {
          const request = yield* HttpServerRequest.HttpServerRequest
          yield* validateOrigin(request, appOrigin)
          const actor = yield* CurrentAccount
          const auth = yield* Auth.Service
          yield* auth.revoke(actor, params.sessionID).pipe(
            Effect.mapError(
              () => new LoginSessionNotFoundError({ id: params.sessionID, message: "Login Session not found" }),
            ),
            Effect.catchDefect(() => Effect.fail(unavailable())),
          )
          return undefined
        }),
      )
      .handle(
        "account.grant.list",
        Effect.fn("AccountHandler.grantList")(function* () {
          const actor = yield* CurrentAccount
          const oauth = yield* OAuth.Service
          const grants = yield* oauth.list(actor).pipe(Effect.catchDefect(() => Effect.fail(unavailable())))
          return grants.map((grant) => ({
            id: grant.id,
            clientID: grant.clientID,
            clientName: grant.clientName,
            createdAt: DateTime.formatIso(grant.createdAt),
            updatedAt: DateTime.formatIso(grant.updatedAt),
            expiresAt: DateTime.formatIso(grant.expiresAt),
          }))
        }),
      )
      .handle(
        "account.grant.revoke",
        Effect.fn("AccountHandler.grantRevoke")(function* ({ params }) {
          const request = yield* HttpServerRequest.HttpServerRequest
          yield* validateOrigin(request, appOrigin)
          const actor = yield* CurrentAccount
          const oauth = yield* OAuth.Service
          yield* oauth.revoke(actor, params.grantID).pipe(
            Effect.mapError(() => new OAuthGrantNotFoundError({ id: params.grantID, message: "OAuth grant not found" })),
            Effect.catchDefect(() => Effect.fail(unavailable())),
          )
          return undefined
        }),
      )
      .handle(
        "account.suspend",
        Effect.fn("AccountHandler.suspend")(function* ({ params }) {
          const actor = yield* requireInstallationAdmin
          const accounts = yield* Account.Service
          yield* audited(
            accounts.suspend(params.accountID).pipe(
              Effect.catchTags({
                "Account.NotFoundError": () => Effect.fail(new InputError({ error: "Account was not found" })),
              }),
              Effect.catchDefect(() => Effect.fail(unavailable())),
            ),
            {
              actor: Audit.principal(actor),
              action: "account.suspend",
              target: params.accountID,
              outcome: "success",
            },
          )
        }),
      )
      .handle(
        "account.restore",
        Effect.fn("AccountHandler.restore")(function* ({ params }) {
          const actor = yield* requireInstallationAdmin
          const accounts = yield* Account.Service
          yield* audited(
            accounts.restore(params.accountID).pipe(
              Effect.catchTags({
                "Account.NotFoundError": () => Effect.fail(new InputError({ error: "Account was not found" })),
              }),
              Effect.catchDefect(() => Effect.fail(unavailable())),
            ),
            {
              actor: Audit.principal(actor),
              action: "account.restore",
              target: params.accountID,
              outcome: "success",
            },
          )
        }),
      ),
  )
