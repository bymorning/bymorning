import { OAuth } from "@bymorning/core/oauth"
import { ForbiddenError, OAuthRequestNotFoundError } from "@bymorning/protocol/errors"
import { CurrentAccount } from "@bymorning/protocol/middleware/account-middleware"
import { Effect } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api.js"
import { validateOrigin } from "../middleware/auth.js"

const notFound = (requestID: import("@bymorning/schema/oauth-authorization").ID) =>
  new OAuthRequestNotFoundError({ requestID, message: "Authorization request not found" })

export const OAuthConsentHandler = (appOrigin: string) => HttpApiBuilder.group(Api, "api.oauth", (handlers) =>
  handlers
    .handle("oauth.request.get", ({ query }) => OAuth.Service.use((oauth) => oauth.request(query.id).pipe(Effect.mapError(() => notFound(query.id)))))
    .handle("oauth.approve", ({ payload }) => Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      yield* validateOrigin(request, appOrigin)
      const account = yield* CurrentAccount
      const oauth = yield* OAuth.Service
      return { url: yield* oauth.approve({ ...payload, account }).pipe(Effect.mapError((error) => error._tag === "User.AccessError" ? new ForbiddenError({ message: "Workspace access denied" }) : notFound(payload.requestID))) }
    }))
    .handle("oauth.deny", ({ payload }) => Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      yield* validateOrigin(request, appOrigin)
      const oauth = yield* OAuth.Service
      return { url: yield* oauth.deny(payload.requestID).pipe(Effect.mapError(() => notFound(payload.requestID))) }
    })),
)
