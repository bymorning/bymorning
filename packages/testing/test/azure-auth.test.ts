import { ByMorning } from "@bymorning/client"
import { Effect } from "effect"
import { expect, test } from "vitest"
import * as TestIssuer from "../../server/test/oidc-idp.js"
import { TestApp } from "../src/application.js"
import { AuthScenario } from "../src/scenario/auth.js"

const cookie = (response: Response, name: string) => response.headers.getSetCookie()
  .find((value) => value.startsWith(`${name}=`))?.split(";", 1)[0]

// The existing OIDC issuer runs on loopback in place of login.microsoftonline.us.
// Tenant/v2.0 discovery, signed ID tokens, PKCE, token exchange, the real Auth
// callback and generated SDK remain real. This is not live Entra verification.
test("Government-shaped Microsoft OIDC validates tokens and preserves verified-email policy", async ({ signal }) => {
  await Effect.runPromise(Effect.gen(function* () {
    const tenant = "11111111-2222-3333-4444-555555555555"
    const issuer = yield* Effect.acquireRelease(
      Effect.tryPromise(() => TestIssuer.start({ issuer: `/${tenant}/v2.0`, tokenAuthMethods: ["client_secret_post"] })),
      (fixture) => Effect.promise(() => fixture.close()).pipe(Effect.orDie),
    )
    const app = yield* TestApp.make({ allowedEmailDomains: ["example.test"] })
    const provider = yield* AuthScenario.createProvider(app, {
      fixture: issuer, displayName: "Microsoft Entra Government", kind: "microsoft", domains: ["example.test"],
    })
    const complete = (identity: TestIssuer.IdentityToken) => Effect.tryPromise(async () => {
      const login = await fetch(new URL(`/auth/login?provider=${provider.id}`, app.origin), { redirect: "manual" })
      expect(login.status).toBe(302)
      const location = new URL(login.headers.get("location")!)
      expect(location.origin).toBe(issuer.issuer.origin)
      expect(location.pathname).toBe(`/${tenant}/oauth2/v2.0/authorize`)
      expect(location.searchParams.get("scope")).toBe("openid email profile")
      expect(new URL(location.searchParams.get("redirect_uri")!).pathname).toBe(`/auth/callback/${provider.id}`)
      const issued = await issuer.authorize(location, identity)
      // TestApp advertises localhost:3000 as its browser origin; route that
      // callback to its allocated API listener, as the existing harness does.
      return fetch(new URL(issued.redirect.pathname + issued.redirect.search, app.origin), {
        redirect: "manual", headers: { cookie: cookie(login, "bm_local_attempt")! },
      })
    })
    const reject = (response: Response, reason: AuthScenario.FailureReason) => {
      expect(response.status).toBe(303)
      const redirect = new URL(response.headers.get("location")!)
      expect(redirect.pathname + redirect.search).toBe(`/login?auth=failed&reason=${reason}`)
      expect(cookie(response, "bm_local_auth")).toBeUndefined()
    }
    const microsoft = { tid: tenant, oid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", ver: "2.0", preferred_username: "person@example.test" }
    // Actual Microsoft claim shapes do not establish a verified email. In
    // particular preferred_username is not an email-verification fallback.
    reject(yield* complete({ sub: "username-only", extra: microsoft }), "claims")
    reject(yield* complete({ sub: "email-unverified", email: "person@example.test", extra: microsoft }), "claims")
    reject(yield* complete({ sub: "email-false", email: "person@example.test", extra: { ...microsoft, email_verified: false } }), "claims")

    // Synthetic verified-email evidence isolates domain/token validation from
    // the Entra blocker above; this claim is not asserted to be an Entra default.
    const verified = { ...microsoft, email_verified: true }
    issuer.tamperNext({ iss: "https://login.microsoftonline.us/other-tenant/v2.0" })
    reject(yield* complete({ sub: "wrong-issuer", email: "person@example.test", extra: verified }), "exchange")
    issuer.tamperNext({ aud: "another-application" })
    reject(yield* complete({ sub: "wrong-audience", email: "person@example.test", extra: verified }), "exchange")
    reject(yield* complete({ sub: "outside-domain", email: "person@outside.test", extra: verified }), "domain")
    const success = yield* complete({ sub: "verified-fixture", email: "person@example.test", extra: verified })
    expect(success.status).toBe(303)
    const session = cookie(success, "bm_local_auth")
    expect(session).toBeDefined()
    const client = ByMorning.make({ baseUrl: app.origin.href, headers: { cookie: session! } })
    expect(yield* Effect.tryPromise(() => client.workspace.list())).toHaveLength(1)
    expect(issuer.tokenRequests).toHaveLength(7)
    expect(issuer.tokenRequests.every((request) => request.auth === "post")).toBe(true)

    issuer.discoveryNext("issuer-mismatch")
    const failed = yield* Effect.tryPromise(() => fetch(new URL(`/auth/login?provider=${provider.id}`, app.origin), { redirect: "manual" }))
    expect(failed.status).not.toBe(302)
    expect(cookie(failed, "bm_local_auth")).toBeUndefined()
  }).pipe(Effect.scoped), { signal })
})
