import { AuthProvider as AuthProviderSchema } from "@bymorning/schema/auth-provider"
import { Effect } from "effect"
import { createServer } from "node:net"
import { expect, test } from "vitest"
import * as TestIssuer from "../../server/test/oidc-idp.js"
import { TestApp } from "../src/application.js"
import { AuthScenario } from "../src/scenario/auth.js"

// A loopback issuer stands in for login.microsoftonline.com/.us with a
// `<tenant>/v2.0` issuer and Entra-shaped ID tokens. Discovery, signatures,
// PKCE, token exchange, the Auth callback, and its redirect are real.
test("reports a coarse, non-sensitive reason for each failed Entra sign-in", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const tenant = "11111111-2222-3333-4444-555555555555"
      const issuer = yield* Effect.acquireRelease(
        Effect.tryPromise(() =>
          TestIssuer.start({ issuer: `/${tenant}/v2.0`, tokenAuthMethods: ["client_secret_post"] }),
        ),
        (fixture) => Effect.promise(() => fixture.close()).pipe(Effect.orDie),
      )
      const app = yield* TestApp.make({ allowedEmailDomains: ["example.test"] })
      const provider = yield* AuthScenario.createProvider(app, {
        fixture: issuer,
        displayName: "Microsoft Entra",
        kind: "microsoft",
        domains: ["example.test"],
      })
      const entra = { tid: tenant, oid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", ver: "2.0" }
      const attempt = (identity: TestIssuer.IdentityToken) =>
        AuthScenario.attemptOidc(app, issuer, provider.id, identity)
      const refused = (
        result: { readonly redirect: URL; readonly reason: string | undefined; readonly session: readonly string[] },
        reason: AuthScenario.FailureReason,
      ) => {
        expect(result.redirect.pathname).toBe("/login")
        expect([...result.redirect.searchParams]).toEqual([
          ["auth", "failed"],
          ["reason", reason],
        ])
        expect(result.reason).toBe(reason)
        expect(result.session).toEqual([])
      }

      // Default Entra app registration: no optional `email` or `xms_edov` claim.
      refused(
        yield* attempt({ sub: "no-optional-claims", extra: { ...entra, preferred_username: "person@example.test" } }),
        "claims",
      )
      // `email` added without `xms_edov`.
      refused(yield* attempt({ sub: "email-only", email: "person@example.test", extra: entra }), "claims")
      // Both claims, but the email domain is not admitted by this Auth Provider.
      const outside = yield* attempt({
        sub: "outside-domain",
        email: "person@outside.test",
        extra: { ...entra, xms_edov: true },
      })
      refused(outside, "domain")
      expect(outside.redirect.href).not.toContain("outside.test")
      // The ID token is refused at the token exchange (wrong audience).
      issuer.tamperNext({ aud: "another-application" })
      refused(
        yield* attempt({ sub: "wrong-audience", email: "person@example.test", extra: { ...entra, xms_edov: true } }),
        "exchange",
      )

      const admitted = yield* attempt({
        sub: "entra-user",
        email: "person@example.test",
        extra: { ...entra, xms_edov: true },
      })
      expect(admitted.reason).toBeUndefined()
      expect(admitted.redirect.pathname).toBe("/")
      expect(admitted.session).not.toEqual([])
    }).pipe(Effect.scoped),
    { signal },
  )
}, 60_000)

test("answers Setup 503 naming the unreachable issuer origin", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      // A loopback port with no listener stands in for an issuer the Gateway cannot reach.
      const port = yield* Effect.promise(
        () =>
          new Promise<number>((resolve, reject) => {
            const server = createServer()
            server.once("error", reject)
            server.listen(0, "127.0.0.1", () => {
              const address = server.address()
              server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject()))
            })
          }),
      )
      const origin = `http://127.0.0.1:${port}`
      const message = `ByMorning could not reach the identity provider at ${origin}. Check that the Gateway has outbound HTTPS access to it.`
      const app = yield* TestApp.make()
      const token = yield* AuthScenario.setupToken(app)
      const payload = {
        type: "create",
        token,
        value: {
          id: AuthProviderSchema.ID.create(),
          displayName: "Microsoft Entra",
          kind: "microsoft",
          domains: ["example.gov"],
          issuer: `${origin}/tenant/v2.0`,
          clientID: "client",
          clientSecret: "secret",
        },
      } as const

      const response = yield* Effect.tryPromise(() =>
        fetch(new URL("/auth/setup", app.origin), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, value: { ...payload.value, id: AuthProviderSchema.ID.create() } }),
        }),
      )
      expect(response.status).toBe(503)
      expect(yield* Effect.promise(() => response.json())).toEqual({ _tag: "ServiceUnavailableError", message })

      // The generated SDK surfaces the same message the Setup page renders.
      const failure = yield* Effect.tryPromise(() => app.client.auth.setup({ payload })).pipe(Effect.flip)
      expect(failure.cause).toMatchObject({ _tag: "ServiceUnavailableError", message })
      const inspected = yield* Effect.tryPromise(() => app.client.auth.inspect({ token }))
      expect(inspected).toEqual([])
    }).pipe(Effect.scoped),
    { signal },
  )
}, 60_000)
