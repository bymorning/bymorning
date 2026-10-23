import { Auth } from "@bymorning/schema/auth"
import { makeGlobalNode } from "@bymorning/util/effect/app-node"
import type { GlobalProvider } from "@bymorning/util/effect/app-node"
import { Cache, Effect, Layer, Redacted } from "effect"
import { randomBytes } from "node:crypto"
import { WebProvider } from "../../../packages/server/src/web-provider.js"

/** Identities used by the test external-identity exchange. */
export interface Identity {
  readonly subject: Auth.Sub
  readonly email: Auth.Email
}

export interface Fixture<E> {
  readonly node: GlobalProvider<WebProvider.Service, E>
  readonly choose: (code: string, identity: Identity) => void
}

/** A provider whose assertion is bound to the authorization code, not process state. */
export const make = (identities: readonly Identity[]): Fixture<never> => {
  const pending = new Map<string, Identity>()
  const choose = (code: string, identity: Identity) => {
    const selected = identities.find(
      (candidate) => candidate.subject === identity.subject && candidate.email === identity.email,
    )
    if (!pending.has(code) || selected === undefined) throw new Error("Unknown or completed test identity exchange")
    pending.set(code, selected)
  }
  const node = makeGlobalNode({
    service: WebProvider.Service,
    layer: Layer.effect(
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
          start: Effect.fn("TestIdentity.start")(function* (redirectURI) {
            if (redirectURI.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(redirectURI.hostname))
              return yield* new WebProvider.ProviderError({ operation: "start", reason: "authorization" })
            const code = `test-${randomBytes(24).toString("base64url")}`
            const state = randomBytes(32).toString("base64url")
            const verifier = randomBytes(32).toString("base64url")
            yield* Cache.set(attempts, code, { verifier, redirectURI: redirectURI.href })
            pending.set(code, identities[0]!)
            const redirect = new URL(redirectURI)
            redirect.searchParams.set("code", code)
            redirect.searchParams.set("state", state)
            return {
              redirect,
              provider: Auth.Provider.make("test"),
              state: Redacted.make(state),
              verifier: Redacted.make(verifier),
            }
          }),
          complete: Effect.fn("TestIdentity.complete")(function* (input) {
            const code = Redacted.value(input.code)
            const attempt = yield* Cache.get(attempts, code)
            yield* Cache.invalidate(attempts, code)
            const identity = pending.get(code)
            pending.delete(code)
            if (
              identity === undefined ||
              attempt.verifier !== Redacted.value(input.verifier) ||
              attempt.redirectURI !== input.redirectURI.href
            )
              return yield* new WebProvider.ProviderError({ operation: "complete", reason: "exchange" })
            return Auth.Assertion.make({
              provider: Auth.Provider.make("test"),
              subject: identity.subject,
              verifiedEmail: identity.email,
            })
          }),
        })
      }),
    ),
    deps: [],
  })
  return { node, choose }
}
