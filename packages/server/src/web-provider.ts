export * as WebProvider from "./web-provider.js"

import { createHash } from "node:crypto"
import { Auth } from "@bymorning/schema/auth"
import { Context, Effect, Layer, Option, Redacted, Schema, SynchronizedRef } from "effect"
import { oauth } from "./oauth4webapi.js"
import { makeGlobalNode, tags } from "@bymorning/util/effect/app-node"
import { LayerNode } from "@bymorning/util/effect/layer-node"

export interface Config {
  readonly provider: Auth.Provider
  readonly issuer: URL
  readonly clientID: string
  readonly clientSecret: Redacted.Redacted<string>
  readonly scopes?: ReadonlyArray<string>
}

export class ConfigError extends Schema.TaggedError<ConfigError>()("WebProvider.ConfigError", {}) {}

export const Reason = Schema.Literals(["discovery", "authorization", "exchange", "token", "claims", "userinfo"])
export type Reason = typeof Reason.Type

export class ProviderError extends Schema.TaggedError<ProviderError>()("WebProvider.ProviderError", {
  operation: Schema.Literals(["start", "complete"]),
  reason: Reason,
  code: Schema.optionalKey(Schema.String),
}) {}

export interface StartResult {
  readonly redirect: URL
  readonly provider: Auth.Provider
  readonly state: Redacted.Redacted
  readonly verifier: Redacted.Redacted
}

export interface Interface {
  readonly start: (redirectURI: URL) => Effect.Effect<StartResult, ProviderError>
  readonly complete: (input: {
    readonly code: Redacted.Redacted
    readonly state: Redacted.Redacted
    readonly verifier: Redacted.Redacted
    readonly redirectURI: URL
  }) => Effect.Effect<Auth.Assertion, ProviderError>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/server/WebProvider") {}

const loopback = (issuer: URL) =>
  issuer.hostname === "127.0.0.1" || issuer.hostname === "localhost" || issuer.hostname === "[::1]"

const validate = (config: Config) =>
  Effect.sync(() => {
    // Loopback issuers are permitted only for the local OIDC fixture used in tests.
    const insecureFixture = config.issuer.protocol === "http:" && loopback(config.issuer)
    if (
      config.clientID.length === 0 ||
      Redacted.value(config.clientSecret).length === 0 ||
      (config.issuer.protocol !== "https:" && !insecureFixture) ||
      config.issuer.username !== "" ||
      config.issuer.password !== "" ||
      config.issuer.search !== "" ||
      config.issuer.hash !== "" ||
      config.provider === "email" ||
      config.provider === "local"
    )
      return undefined
    return { ...config, issuer: new URL(config.issuer.href), insecureFixture }
  }).pipe(Effect.flatMap((value) => (value === undefined ? Effect.fail(new ConfigError({})) : Effect.succeed(value))))

const nonceFor = (verifier: string) => createHash("sha256").update(verifier).digest("base64url")

/** Standard OIDC confidential-client adapter. Discovery is lazy; construction never performs I/O. */
export const layer = (config: Config): Layer.Layer<Service, ConfigError> =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const checked = yield* validate(config)
      const client = { client_id: checked.clientID, [oauth.clockTolerance]: 60 }
      const requestOptions = checked.insecureFixture ? { [oauth.allowInsecureRequests]: true } : undefined
      const discovered = yield* SynchronizedRef.make(Option.none<oauth.AuthorizationServer>())
      const error = (operation: "start" | "complete", reason: Reason, code?: string) =>
        new ProviderError({ operation, reason, ...(code === undefined ? {} : { code }) })

      const discover = Effect.fn("WebProvider.discovery")(function* () {
        const response = yield* Effect.tryPromise({
          try: () => oauth.discoveryRequest(checked.issuer, requestOptions),
          catch: () => error("start", "discovery"),
        })
        const metadata = yield* Effect.tryPromise({
          try: () => oauth.processDiscoveryResponse(checked.issuer, response),
          catch: () => error("start", "discovery"),
        })
        if (
          !metadata.authorization_endpoint ||
          !metadata.token_endpoint ||
          !metadata.jwks_uri ||
          (metadata.code_challenge_methods_supported !== undefined &&
            !metadata.code_challenge_methods_supported.includes("S256"))
        )
          return yield* error("start", "discovery")
        return metadata
      })
      // The synchronized update deduplicates concurrent discovery. Only a successful result is stored.
      const metadata = () =>
        SynchronizedRef.modifyEffect(discovered, (current) =>
          Option.match(current, {
            onNone: () => discover().pipe(Effect.map((value) => [value, Option.some(value)] as const)),
            onSome: (value) => Effect.succeed([value, current] as const),
          }),
        )

      const start = Effect.fn("WebProvider.start")(function* (redirectURI: URL) {
        const as = yield* metadata()
        const { verifier, state } = yield* Effect.try({
          try: () => ({ verifier: oauth.generateRandomCodeVerifier(), state: oauth.generateRandomState() }),
          catch: () => error("start", "authorization"),
        })
        const nonce = nonceFor(verifier)
        const challenge = yield* Effect.tryPromise({
          try: () => oauth.calculatePKCECodeChallenge(verifier),
          catch: () => error("start", "authorization"),
        })
        const redirect = yield* Effect.try({
          try: () => {
            const url = new URL(as.authorization_endpoint!)
            if (url.origin !== new URL(as.authorization_endpoint!).origin) throw new Error("invalid endpoint")
            url.search = new URLSearchParams({
              response_type: "code",
              client_id: checked.clientID,
              redirect_uri: redirectURI.href,
              scope: Array.from(new Set(["openid", "email", "profile", ...(checked.scopes ?? [])])).join(" "),
              state,
              nonce,
              code_challenge: challenge,
              code_challenge_method: "S256",
            }).toString()
            return url
          },
          catch: () => error("start", "authorization"),
        })
        if (redirect.origin !== checked.issuer.origin) return yield* error("start", "authorization")
        return { redirect, provider: checked.provider, state: Redacted.make(state), verifier: Redacted.make(verifier) }
      })

      const complete = Effect.fn("WebProvider.complete")(function* (input: Parameters<Interface["complete"]>[0]) {
        const as = yield* metadata().pipe(Effect.mapError(() => error("complete", "exchange")))
        const verifier = Redacted.value(input.verifier)
        // Google rejects percent-encoded Basic credentials, so honor discovery's advertised order.
        const auth = (() => {
          const methods = as.token_endpoint_auth_methods_supported
          if (methods === undefined) return oauth.ClientSecretBasic(Redacted.value(checked.clientSecret))
          for (const method of methods) {
            if (method === "client_secret_post") return oauth.ClientSecretPost(Redacted.value(checked.clientSecret))
            if (method === "client_secret_basic") return oauth.ClientSecretBasic(Redacted.value(checked.clientSecret))
          }
          return undefined
        })()
        if (auth === undefined) return yield* error("complete", "discovery")
        // oauth4webapi brands callback parameters through validation. The handler already owns
        // state validation; this deployment has one fixed issuer, so RFC 9207 issuer mix-up
        // protection is unnecessary. PKCE and nonce bind the code to that validated attempt.
        const callback = yield* Effect.try({
          try: () =>
            oauth.validateAuthResponse(
              { ...as, authorization_response_iss_parameter_supported: false },
              client,
              new URLSearchParams({ code: Redacted.value(input.code), state: Redacted.value(input.state) }),
              oauth.skipStateCheck,
            ),
          catch: () => error("complete", "exchange"),
        })
        const response = yield* Effect.tryPromise({
          try: () =>
            oauth.authorizationCodeGrantRequest(
              as,
              client,
              auth,
              callback,
              input.redirectURI.href,
              verifier,
              requestOptions,
            ),
          catch: () => error("complete", "exchange"),
        })
        const tokens = yield* Effect.tryPromise({
          try: () =>
            oauth.processAuthorizationCodeResponse(as, client, response, { expectedNonce: nonceFor(verifier) }),
          catch: (cause) =>
            cause instanceof oauth.ResponseBodyError
              ? error("complete", "exchange", cause.error)
              : error("complete", "token"),
        })
        const claims = yield* Effect.try({
          try: () => oauth.getValidatedIdTokenClaims(tokens),
          catch: () => error("complete", "token"),
        })
        if (!claims) return yield* error("complete", "exchange")
        // oauth4webapi caches JWKS per metadata object. On an unknown key it only refreshes aged
        // caches, so retry once with a fresh metadata object to handle immediate key rotation.
        yield* Effect.tryPromise({
          try: async () => {
            try {
              await oauth.validateApplicationLevelSignature(as, response, requestOptions)
            } catch {
              await oauth.validateApplicationLevelSignature({ ...as }, response, requestOptions)
            }
          },
          catch: () => error("complete", "token"),
        })
        if (claims.sub.length === 0) return yield* error("complete", "claims")
        const email =
          typeof claims.email === "string"
            ? claims.email
            : yield* Effect.tryPromise({
                try: async () => {
                  const response = await oauth.userInfoRequest(as, client, tokens.access_token, requestOptions)
                  return (await oauth.processUserInfoResponse(as, client, claims.sub, response)).email
                },
                catch: () => error("complete", "userinfo"),
              })
        const verifiedEmail = yield* Schema.decodeUnknownEffect(Auth.Email)(email).pipe(
          Effect.mapError(() => error("complete", "claims")),
        )
        return Auth.Assertion.make({
          provider: checked.provider,
          subject: Auth.Sub.make(claims.sub),
          verifiedEmail,
        })
      })

      return Service.of({ start, complete })
    }),
  )

export const configured = (config: Config) =>
  makeGlobalNode({ service: Service, layer: layer(config).pipe(Layer.orDie), deps: [] })

export const node = LayerNode.unbound<Service, Interface, typeof tags.values.global, unknown>(
  Service,
  tags.values.global,
)
