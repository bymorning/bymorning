import { Auth } from "@bymorning/schema/auth"
import { Cause, Effect, Exit, Redacted } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { start, type Fixture } from "../test/oidc-idp.js"
import { WebProvider } from "./web-provider.js"

const callback = new URL("https://app.example.test/auth/callback")
const provider = Auth.Provider.make("okta")
const config = (fixture: Fixture, extra: Partial<WebProvider.Config> = {}): WebProvider.Config => ({
  provider,
  issuer: fixture.issuer,
  clientID: fixture.clientID,
  clientSecret: Redacted.make(fixture.clientSecret),
  ...extra,
})
const service = <A>(
  configuration: WebProvider.Config,
  f: (provider: WebProvider.Interface) => Effect.Effect<A, WebProvider.ProviderError>,
) =>
  Effect.gen(function* () {
    return yield* f(yield* WebProvider.Service)
  }).pipe(Effect.provide(WebProvider.layer(configuration)))
const reason = async (effect: Effect.Effect<unknown, WebProvider.ProviderError | WebProvider.ConfigError>) => {
  const exit = await Effect.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) throw new Error("Expected provider failure")
  const failure = exit.cause.reasons.find(Cause.isFailReason)?.error
  if (!(failure instanceof WebProvider.ProviderError)) throw new Error("Expected typed provider failure")
  return failure.reason
}
const providerError = async (effect: Effect.Effect<unknown, WebProvider.ProviderError | WebProvider.ConfigError>) => {
  const exit = await Effect.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) throw new Error("Expected provider failure")
  const failure = exit.cause.reasons.find(Cause.isFailReason)?.error
  if (!(failure instanceof WebProvider.ProviderError)) throw new Error("Expected typed provider failure")
  return failure
}
const flow = async (
  fixture: Fixture,
  configuration = config(fixture),
  identity = { sub: "person", email: "person@example.test" },
) => {
  const started = await Effect.runPromise(service(configuration, (web) => web.start(callback)))
  const issued = await fixture.authorize(started.redirect, identity)
  return {
    started,
    issued,
    complete: () =>
      service(configuration, (web) =>
        web.complete({
          code: Redacted.make(issued.code),
          state: started.state,
          verifier: started.verifier,
          redirectURI: callback,
        }),
      ),
  }
}

describe("WebProvider", () => {
  let fixture: Fixture | undefined
  afterEach(async () => {
    await fixture?.close()
    fixture = undefined
  })

  it("validates configuration without performing discovery", async () => {
    fixture = await start()
    const invalid = [
      { issuer: new URL("http://idp.example.test") },
      { issuer: new URL("https://user:pass@idp.example.test") },
      { issuer: new URL("https://idp.example.test?query") },
      { issuer: new URL("https://idp.example.test#fragment") },
      { clientID: "" },
      { clientSecret: Redacted.make("") },
      { provider: Auth.Provider.make("email") },
      { provider: Auth.Provider.make("local") },
    ]
    for (const values of invalid)
      expect(
        (
          await Effect.runPromiseExit(
            WebProvider.Service.pipe(Effect.provide(WebProvider.layer(config(fixture, values)))),
          )
        )._tag,
      ).toBe("Failure")
    const path = config(fixture, { issuer: new URL(`${fixture.issuer.href}tenant/v2.0`) })
    expect((await Effect.runPromiseExit(WebProvider.Service.pipe(Effect.provide(WebProvider.layer(path)))))._tag).toBe(
      "Success",
    )
  })

  it("starts fresh PKCE flows at the discovered authorization endpoint", async () => {
    fixture = await start()
    const configuration = config(fixture, { scopes: ["groups", "email"] })
    const first = await Effect.runPromise(service(configuration, (web) => web.start(callback)))
    const second = await Effect.runPromise(service(configuration, (web) => web.start(callback)))
    expect(first.redirect.origin).toBe(fixture.issuer.origin)
    expect(first.redirect.searchParams.get("response_type")).toBe("code")
    expect(first.redirect.searchParams.get("code_challenge_method")).toBe("S256")
    expect(first.redirect.searchParams.get("scope")?.split(" ")).toEqual(["openid", "email", "profile", "groups"])
    expect(first.redirect.searchParams.get("state")).toBe(Redacted.value(first.state))
    expect(first.redirect.searchParams.get("nonce")).toBeTruthy()
    expect(first.redirect.searchParams.get("code_challenge")).toBeTruthy()
    expect(Redacted.value(first.state)).not.toBe(Redacted.value(second.state))
    expect(Redacted.value(first.verifier)).not.toBe(Redacted.value(second.verifier))
  })

  it("reports discovery errors", async () => {
    fixture = await start({ issuer: "http://127.0.0.1:1" })
    expect(await reason(service(config(fixture), (web) => web.start(callback)))).toBe("discovery")
  })

  it("does not cache failed discovery and rejects mismatched discovery metadata", async () => {
    fixture = await start()
    const configuration = config(fixture)
    fixture.discoveryNext("fail")
    expect(await reason(service(configuration, (web) => web.start(callback)))).toBe("discovery")
    await expect(Effect.runPromise(service(configuration, (web) => web.start(callback)))).resolves.toMatchObject({
      provider,
    })
    const mismatch = await start()
    try {
      mismatch.discoveryNext("issuer-mismatch")
      expect(await reason(service(config(mismatch), (web) => web.start(callback)))).toBe("discovery")
    } finally {
      await mismatch.close()
    }
  })

  it("rejects an authorization endpoint with the wrong origin", async () => {
    fixture = await start()
    fixture.discoveryNext("wrong-authorization-origin")
    expect(await reason(service(config(fixture), (web) => web.start(callback)))).toBe("authorization")
  })

  it("completes a verified authorization-code flow", async () => {
    fixture = await start()
    const result = await Effect.runPromise((await flow(fixture)).complete())
    expect(result).toEqual({ provider: "okta", subject: "person", verifiedEmail: "person@example.test" })
  })

  it("completes when the issuer advertises the RFC 9207 iss response parameter", async () => {
    fixture = await start({ advertiseIssParameter: true })
    await expect(Effect.runPromise((await flow(fixture)).complete())).resolves.toMatchObject({ subject: "person" })
  })

  it("reports exchange failures for wrong verifiers and reused codes", async () => {
    fixture = await start()
    const attempt = await flow(fixture)
    await expect(
      providerError(
        service(config(fixture), (web) =>
          web.complete({
            code: Redacted.make(attempt.issued.code),
            state: attempt.started.state,
            verifier: Redacted.make("wrong-verifier"),
            redirectURI: callback,
          }),
        ),
      ),
    ).resolves.toMatchObject({ reason: "exchange", code: "invalid_grant" })
    const reusable = await flow(fixture)
    await Effect.runPromise(reusable.complete())
    expect(await reason(reusable.complete())).toBe("exchange")
  })

  it("fails bogus codes as typed exchange errors rather than defects", async () => {
    fixture = await start()
    const started = await Effect.runPromise(service(config(fixture), (web) => web.start(callback)))
    const exit = await Effect.runPromiseExit(
      service(config(fixture), (web) =>
        web.complete({
          code: Redacted.make("completely-bogus"),
          state: started.state,
          verifier: started.verifier,
          redirectURI: callback,
        }),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isSuccess(exit)) throw new Error("Expected provider failure")
    expect(exit.cause.reasons.some(Cause.isDieReason)).toBe(false)
    const failure = exit.cause.reasons.find(Cause.isFailReason)?.error
    expect(failure).toBeInstanceOf(WebProvider.ProviderError)
    expect((failure as WebProvider.ProviderError).reason).toBe("exchange")
  })

  it("uses the first supported advertised client authentication method", async () => {
    fixture = await start({ tokenAuthMethods: ["client_secret_post", "client_secret_basic"] })
    await expect(Effect.runPromise((await flow(fixture)).complete())).resolves.toMatchObject({ subject: "person" })
    expect(fixture.tokenRequests).toEqual([{ auth: "post" }])
  })

  it("uses client_secret_basic when it is the first supported advertised method", async () => {
    fixture = await start({ tokenAuthMethods: ["client_secret_basic"] })
    await expect(Effect.runPromise((await flow(fixture)).complete())).resolves.toMatchObject({ subject: "person" })
    expect(fixture.tokenRequests).toEqual([{ auth: "basic" }])
  })

  it("defaults to client_secret_basic when discovery omits authentication methods", async () => {
    fixture = await start({ advertiseTokenAuthMethods: false })
    await expect(Effect.runPromise((await flow(fixture)).complete())).resolves.toMatchObject({ subject: "person" })
    expect(fixture.tokenRequests).toEqual([{ auth: "basic" }])
  })

  it("rejects discovery without a supported client authentication method", async () => {
    fixture = await start({ tokenAuthMethods: ["private_key_jwt"] })
    expect(await reason((await flow(fixture)).complete())).toBe("discovery")
    expect(fixture.tokenRequests).toEqual([])
  })

  it("reports invalid ID tokens and refetches after rotation", async () => {
    fixture = await start()
    fixture.signNextWithUnknownKey()
    expect(await reason((await flow(fixture)).complete())).toBe("token")
    for (const tampered of [{ iss: "https://wrong.example" }, { aud: "wrong" }, { nonce: "wrong" }, { exp: 0 }]) {
      fixture.tamperNext(tampered)
      expect(await reason((await flow(fixture)).complete())).toBe("token")
    }
    await Effect.runPromise((await flow(fixture)).complete())
    await fixture.rotateKeys()
    await expect(Effect.runPromise((await flow(fixture)).complete())).resolves.toMatchObject({ subject: "person" })
  })

  it("uses userinfo only when needed and validates returned email", async () => {
    fixture = await start()
    // `extra` suppresses the ID-token claim while the access-token identity retains it for userinfo.
    const noTokenEmail = { sub: "person", email: "person@example.test", extra: { email: undefined } }
    await expect(
      Effect.runPromise((await flow(fixture, config(fixture), noTokenEmail)).complete()),
    ).resolves.toMatchObject({ verifiedEmail: "person@example.test" })
    fixture.userinfoNext("sub-mismatch")
    expect(await reason((await flow(fixture, config(fixture), noTokenEmail)).complete())).toBe("userinfo")
    fixture.userinfoNext("fail")
    expect(await reason((await flow(fixture, config(fixture), noTokenEmail)).complete())).toBe("userinfo")
    expect(
      await reason((await flow(fixture, config(fixture), { sub: "person", email: "not-an-email" })).complete()),
    ).toBe("claims")
  })
})
