import { Auth } from "@bymorning/schema/auth"
import { makeGlobalNode } from "@bymorning/util/effect/app-node"
import { WebProvider } from "../../web-provider.js"
import { Cache, Effect, Layer, Redacted } from "effect"
import { randomBytes } from "node:crypto"

/** A local login has the same callback contract as external authentication. */
export const layer = (identity: { readonly subject: Auth.Sub; readonly email: Auth.Email }) =>
  Layer.effect(
    WebProvider.Service,
    Effect.gen(function* () {
      const attempts = yield* Cache.make({
        capacity: 128,
        timeToLive: "10 minutes",
        lookup: (
          _key: string,
        ): Effect.Effect<{ readonly verifier: string; readonly redirectURI: string }, WebProvider.ProviderError> =>
          Effect.fail(new WebProvider.ProviderError({ operation: "complete", reason: "exchange" })),
      })
      return WebProvider.Service.of({
        start: Effect.fn("LocalWebProvider.start")(function* (redirectURI) {
          if (redirectURI.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(redirectURI.hostname))
            return yield* new WebProvider.ProviderError({ operation: "start", reason: "authorization" })
          const code = randomBytes(32).toString("base64url")
          const state = randomBytes(32).toString("base64url")
          const verifier = randomBytes(32).toString("base64url")
          yield* Cache.set(attempts, code, { verifier, redirectURI: redirectURI.href })
          const redirect = new URL(redirectURI)
          redirect.searchParams.set("code", code)
          redirect.searchParams.set("state", state)
          return {
            redirect,
            provider: Auth.Provider.make("local"),
            state: Redacted.make(state),
            verifier: Redacted.make(verifier),
          }
        }),
        complete: Effect.fn("LocalWebProvider.complete")(function* (input) {
          const code = Redacted.value(input.code)
          const attempt = yield* Cache.get(attempts, code)
          yield* Cache.invalidate(attempts, code)
          if (attempt.verifier !== Redacted.value(input.verifier) || attempt.redirectURI !== input.redirectURI.href)
            return yield* new WebProvider.ProviderError({ operation: "complete", reason: "exchange" })
          return Auth.Assertion.make({
            provider: Auth.Provider.make("local"),
            subject: identity.subject,
            verifiedEmail: identity.email,
          })
        }),
      })
    }),
  )
export const node = (identity: Parameters<typeof layer>[0]) =>
  makeGlobalNode({ service: WebProvider.Service, layer: layer(identity), deps: [] })
export * as LocalWebProvider from "./identity-local.js"
