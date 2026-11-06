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

/**
 * Where a client's redirect URIs send an approval, reduced to scheme and host (and port) so nothing else in the URI
 * is shown or trusted. Web URIs keep their origin (no credentials, path, query, or default port); custom schemes such
 * as `cursor://app` keep `scheme://host`; a URI with no host keeps its scheme and, for an opaque path, its first
 * segment (`com.example.app:/callback` becomes `com.example.app:`). Unparseable URIs are dropped. Distinct and sorted.
 */
export const redirectOrigins = (uris: ReadonlyArray<string>): ReadonlyArray<string> =>
  [
    ...new Set(
      uris.flatMap((uri) => {
        if (!URL.canParse(uri)) return []
        const url = new URL(uri)
        if (url.origin !== "null") return [url.origin]
        return [url.host === "" ? `${url.protocol}${url.pathname.split("/")[0]}` : `${url.protocol}//${url.host}`]
      }),
    ),
  ].sort()

export const OAuthConsentHandler = (appOrigin: string) => HttpApiBuilder.group(Api, "api.oauth", (handlers) =>
  handlers
    .handle("oauth.request.get", ({ query }) =>
      Effect.gen(function* () {
        const oauth = yield* OAuth.Service
        const request = yield* oauth.request(query.id).pipe(Effect.mapError(() => notFound(query.id)))
        const client = yield* oauth.client(request.clientID)
        // A request always has a registered client; if it vanished, refuse rather than show an unverified page.
        if (client === undefined) return yield* notFound(query.id)
        return { ...request, redirectOrigins: redirectOrigins(client.redirectUris) }
      }),
    )
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
