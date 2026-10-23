export * as Oidc from "./oidc.js"

import { Auth } from "@bymorning/schema/auth"
import { createHash } from "node:crypto"
import { Effect, Redacted, Schema } from "effect"
import type { Client } from "oauth4webapi"
import { ClientSecretBasic, ClientSecretPost, allowInsecureRequests, authorizationCodeGrantRequest, calculatePKCECodeChallenge, clockTolerance, discoveryRequest, generateRandomCodeVerifier, generateRandomState, getValidatedIdTokenClaims, processAuthorizationCodeResponse, processDiscoveryResponse, processUserInfoResponse, userInfoRequest, validateApplicationLevelSignature, validateAuthResponse } from "oauth4webapi"
import type { Active } from "../auth-provider.js"
import { RejectedError, UnavailableError } from "./error.js"

const loopback = (hostname: string) => hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]"
const nonceFor = (verifier: string) => createHash("sha256").update(verifier).digest("base64url")
const unavailable = (operation: "open" | "complete") =>
  new UnavailableError({ operation, message: "Authentication is unavailable" })
const rejected = (reason: RejectedError["reason"]) => new RejectedError({ reason, message: "Authentication failed" })

/**
 * Whether the ID token vouches for its email. `email_verified` is the OpenID
 * Connect claim; an explicit `false` is authoritative and is never overridden.
 * Microsoft Entra ID omits `email_verified` and instead offers the optional
 * `xms_edov` claim (email domain owner verified), which attests only the `email`
 * claim of the same ID token, so it is ignored for an email fetched from userinfo.
 * Only the JSON boolean `true` counts; strings and other values do not.
 */
export const emailVerified = (claims: Readonly<Record<string, unknown>>, emailFromToken: boolean) => {
  if (claims.email_verified === false) return false
  return claims.email_verified === true || (emailFromToken && claims.xms_edov === true)
}

const metadata = (active: Active) =>
  Effect.gen(function* () {
    const issuer = new URL(active.issuer)
    const insecureFixture = issuer.protocol === "http:" && loopback(issuer.hostname)
    const requestOptions = insecureFixture ? { [allowInsecureRequests]: true } : undefined
    const response = yield* Effect.tryPromise({
      try: () => discoveryRequest(issuer, requestOptions),
      catch: () => unavailable("open"),
    })
    const as = yield* Effect.tryPromise({
      try: () => processDiscoveryResponse(issuer, response),
      catch: () => unavailable("open"),
    })
    if (
      !as.authorization_endpoint ||
      !as.token_endpoint ||
      !as.jwks_uri ||
      (as.code_challenge_methods_supported !== undefined && !as.code_challenge_methods_supported.includes("S256"))
    ) {
      return yield* unavailable("open")
    }
    return { as, issuer, requestOptions, client: { client_id: active.clientID, [clockTolerance]: 60 } as Client }
  })

/** Start an OIDC authorization-code PKCE attempt for one Auth Provider. */
export const start = Effect.fn("Auth.oidc.start")(function* (active: Active, redirectURI: URL) {
  const { as, issuer } = yield* metadata(active)
  const verifier = generateRandomCodeVerifier()
  const state = generateRandomState()
  const challenge = yield* Effect.tryPromise({
    try: () => calculatePKCECodeChallenge(verifier),
    catch: () => unavailable("open"),
  })
  const redirect = yield* Effect.try({
    try: () => {
      const url = new URL(as.authorization_endpoint!)
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: active.clientID,
        redirect_uri: redirectURI.href,
        scope: "openid email profile",
        state,
        nonce: nonceFor(verifier),
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString()
      return url
    },
    catch: () => unavailable("open"),
  })
  if (redirect.origin !== issuer.origin) return yield* unavailable("open")
  return {
    redirect,
    state: Redacted.make(state),
    verifier: Redacted.make(verifier),
  }
})

/** Complete an OIDC callback into a verified Subject. */
export const complete = Effect.fn("Auth.oidc.complete")(function* (input: {
  readonly active: Active
  readonly attempt: Auth.Attempt
  readonly response: Redacted.Redacted<URLSearchParams>
}) {
  if (input.attempt.binding.type !== "oidc") {
    return yield* rejected("callback")
  }
  const { as, requestOptions, client } = yield* metadata(input.active).pipe(Effect.mapError(() => unavailable("complete")))
  const verifier = Redacted.value(input.attempt.verifier)
  const methods = as.token_endpoint_auth_methods_supported
  const auth = (() => {
    const secret = Redacted.value(input.active.clientSecret)
    if (methods === undefined) return ClientSecretBasic(secret)
    for (const method of methods) {
      if (method === "client_secret_post") return ClientSecretPost(secret)
      if (method === "client_secret_basic") return ClientSecretBasic(secret)
    }
    return undefined
  })()
  if (auth === undefined) return yield* unavailable("complete")
  const params = Redacted.value(input.response)
  const callback = yield* Effect.try({
    try: () =>
      validateAuthResponse(
        { ...as, authorization_response_iss_parameter_supported: false },
        client,
        params,
        Redacted.value(input.attempt.state),
      ),
    catch: () => rejected("response"),
  })
  const tokenResponse = yield* Effect.tryPromise({
    try: () =>
      authorizationCodeGrantRequest(
        as,
        client,
        auth,
        callback,
        input.attempt.redirectURI.href,
        verifier,
        requestOptions,
      ),
    catch: () => rejected("exchange"),
  })
  const tokens = yield* Effect.tryPromise({
    // A token endpoint error response (invalid_client, invalid_grant) and an
    // ID token that fails validation both surface here.
    try: () => processAuthorizationCodeResponse(as, client, tokenResponse, { expectedNonce: nonceFor(verifier) }),
    catch: () => rejected("exchange"),
  })
  const claims = yield* Effect.try({
    try: () => getValidatedIdTokenClaims(tokens),
    catch: () => rejected("token"),
  })
  if (!claims || claims.sub.length === 0) return yield* rejected("token")
  yield* Effect.tryPromise({
    try: async () => {
      try {
        await validateApplicationLevelSignature(as, tokenResponse, requestOptions)
      } catch {
        await validateApplicationLevelSignature({ ...as }, tokenResponse, requestOptions)
      }
    },
    catch: () => rejected("token"),
  })
  const emailFromToken = typeof claims.email === "string"
  const email =
    emailFromToken
      ? claims.email
      : yield* Effect.tryPromise({
          try: async () => {
            const response = await userInfoRequest(as, client, tokens.access_token, requestOptions)
            return (await processUserInfoResponse(as, client, claims.sub, response)).email
          },
          // Reached only when the ID token has no email claim.
          catch: () => rejected("email-missing"),
        })
  const parsed = yield* Schema.decodeUnknownEffect(Auth.Email)(email).pipe(
    Effect.mapError(() => rejected("email-missing")),
  )
  const verified = emailVerified(claims, emailFromToken)
  return Auth.OidcSubject.make({
    type: "oidc",
    provider: input.attempt.binding.provider,
    sub: Auth.Sub.make(claims.sub),
    email: parsed,
    emailVerified: verified,
  })
})
