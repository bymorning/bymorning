import { OAuth } from "@bymorning/core/oauth"
import { OAuthAuthorization } from "@bymorning/schema/oauth-authorization"
import { OAuthClient } from "@bymorning/schema/oauth-client"
import { Effect, Option, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api.js"

const Registration = Schema.Struct({
  redirect_uris: Schema.Array(Schema.String),
  client_name: Schema.optionalKey(Schema.String),
  token_endpoint_auth_method: Schema.optionalKey(Schema.String),
})
const json = (body: unknown, status = 200) => HttpServerResponse.jsonUnsafe(body, { status })
const redirect = (url: URL) => HttpServerResponse.empty({ status: 302, headers: { location: url.href } })
const oauthErrorRedirect = (uri: string, error: string, state?: string) => {
  const url = new URL(uri)
  url.searchParams.append("error", error)
  if (state !== undefined) url.searchParams.append("state", state)
  return redirect(url)
}
const bodyText = Effect.fn("OAuthHandler.bodyText")(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie)
  return yield* Effect.promise(() => web.text())
})

export const OAuthRawHandler = (appOrigin: string) => HttpApiBuilder.group(Api, "oauth.raw", (handlers) =>
  handlers
    .handleRaw("oauth.protectedResource", () => Effect.succeed(json({ resource: new URL("/mcp", appOrigin).href, authorization_servers: [new URL("/", appOrigin).href.replace(/\/$/, "")], bearer_methods_supported: ["header"] })))
    .handleRaw("oauth.authorizationServer", () => Effect.succeed(json({ issuer: new URL("/", appOrigin).href.replace(/\/$/, ""), authorization_endpoint: new URL("/oauth/authorize", appOrigin).href, token_endpoint: new URL("/oauth/token", appOrigin).href, registration_endpoint: new URL("/oauth/register", appOrigin).href, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] })))
    .handleRaw("oauth.register", () => Effect.gen(function* () {
      const raw = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(yield* bodyText())
      const decoded = Option.flatMap(raw, Schema.decodeUnknownOption(Registration))
      if (Option.isNone(decoded)) {
        const invalidRedirect = Option.isNone(raw) || typeof raw.value !== "object" || raw.value === null || !("redirect_uris" in raw.value) || !Array.isArray(raw.value.redirect_uris) || raw.value.redirect_uris.length === 0 || raw.value.redirect_uris.some((uri) => typeof uri !== "string" || !isValidRedirect(uri))
        return json({ error: invalidRedirect ? "invalid_redirect_uri" : "invalid_client_metadata" }, 400)
      }
      if (decoded.value.redirect_uris.length === 0 || decoded.value.redirect_uris.some((uri) => !isValidRedirect(uri))) return json({ error: "invalid_redirect_uri" }, 400)
      if (decoded.value.token_endpoint_auth_method !== undefined && decoded.value.token_endpoint_auth_method !== "none") return json({ error: "invalid_client_metadata" }, 400)
      const oauth = yield* OAuth.Service
      const client = yield* oauth.register({ redirectUris: decoded.value.redirect_uris, ...(decoded.value.client_name === undefined ? {} : { name: decoded.value.client_name }) })
      return json({ client_id: client.id, redirect_uris: decoded.value.redirect_uris, ...(decoded.value.client_name === undefined ? {} : { client_name: decoded.value.client_name }), token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, 201)
    }))
    .handleRaw("oauth.authorize", ({ query }) => Effect.gen(function* () {
      const clientID = Schema.decodeUnknownOption(OAuthClient.ID)(query.client_id)
      if (Option.isNone(clientID) || query.redirect_uri === undefined) return HttpServerResponse.empty({ status: 400 })
      const oauth = yield* OAuth.Service
      const client = yield* oauth.client(clientID.value)
      if (client === undefined || !client.redirectUris.includes(query.redirect_uri)) return HttpServerResponse.empty({ status: 400 })
      if (query.response_type !== "code") return oauthErrorRedirect(query.redirect_uri, "unsupported_response_type", query.state)
      if (query.code_challenge === undefined || query.code_challenge_method !== "S256") return oauthErrorRedirect(query.redirect_uri, "invalid_request", query.state)
      const id = yield* oauth.authorize({ clientID: client.id, redirectURI: query.redirect_uri, codeChallenge: query.code_challenge, ...(query.state === undefined ? {} : { state: query.state }) })
      return redirect(new URL(`/oauth/consent?request=${encodeURIComponent(id)}`, appOrigin))
    }))
    .handleRaw("oauth.token", () => Effect.gen(function* () {
      const form = new URLSearchParams(yield* bodyText())
      const grantType = form.get("grant_type")
      if (grantType === null) return json({ error: "invalid_request" }, 400)
      if (grantType !== "authorization_code" && grantType !== "refresh_token") return json({ error: "unsupported_grant_type" }, 400)
      const oauth = yield* OAuth.Service
      if (grantType === "authorization_code") {
        const code = form.get("code")
        const verifier = form.get("code_verifier")
        const clientID = Schema.decodeUnknownOption(OAuthClient.ID)(form.get("client_id"))
        const redirectURI = form.get("redirect_uri")
        if (!code || !verifier || Option.isNone(clientID) || !redirectURI) return json({ error: "invalid_request" }, 400)
        const tokens = yield* oauth.exchangeCode({ code, verifier, clientID: clientID.value, redirectURI }).pipe(Effect.option)
        if (Option.isNone(tokens)) return json({ error: "invalid_grant" }, 400)
        return json({ access_token: tokens.value.accessToken, token_type: "Bearer", expires_in: 3600, refresh_token: tokens.value.refreshToken })
      }
      const refreshToken = form.get("refresh_token")
      const clientID = Schema.decodeUnknownOption(OAuthClient.ID)(form.get("client_id"))
      if (!refreshToken || Option.isNone(clientID)) return json({ error: "invalid_request" }, 400)
      const tokens = yield* oauth.refresh({ refreshToken, clientID: clientID.value }).pipe(Effect.option)
      if (Option.isNone(tokens)) return json({ error: "invalid_grant" }, 400)
      return json({ access_token: tokens.value.accessToken, token_type: "Bearer", expires_in: 3600, refresh_token: tokens.value.refreshToken })
    })),
)

function isValidRedirect(value: string) {
  if (!URL.canParse(value)) return false
  return !value.includes("#")
}
