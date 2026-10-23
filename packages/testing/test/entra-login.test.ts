import { ByMorning } from "@bymorning/client"
import { Effect } from "effect"
import { expect, test } from "vitest"
import * as TestIssuer from "../../server/test/oidc-idp.js"
import { TestApp } from "../src/application.js"
import { AuthScenario } from "../src/scenario/auth.js"

const cookie = (response: Response, name: string) =>
  response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${name}=`))
    ?.split(";", 1)[0]

// A loopback issuer stands in for login.microsoftonline.com/.us with a
// `<tenant>/v2.0` issuer and Entra-shaped ID tokens: no `email_verified`, the
// optional `email` and `xms_edov` claims. Discovery, signatures, PKCE, token
// exchange, the Auth callback and the generated SDK are real. This is not live
// Entra verification.
test("Entra-shaped ID tokens sign in through xms_edov and still enforce admitted domains", async ({ signal }) => {
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
      const complete = (identity: TestIssuer.IdentityToken) =>
        Effect.tryPromise(async () => {
          const login = await fetch(new URL(`/auth/login?provider=${provider.id}`, app.origin), { redirect: "manual" })
          expect(login.status).toBe(302)
          const location = new URL(login.headers.get("location")!)
          const issued = await issuer.authorize(location, identity)
          return fetch(new URL(issued.redirect.pathname + issued.redirect.search, app.origin), {
            redirect: "manual",
            headers: { cookie: cookie(login, "bm_local_attempt")! },
          })
        })
      const reject = (response: Response, reason: AuthScenario.FailureReason) => {
        expect(response.status).toBe(303)
        expect(
          new URL(response.headers.get("location")!).pathname + new URL(response.headers.get("location")!).search,
        ).toBe(`/login?auth=failed&reason=${reason}`)
        expect(cookie(response, "bm_local_auth")).toBeUndefined()
      }
      const entra = {
        tid: tenant,
        oid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        ver: "2.0",
        preferred_username: "person@example.test",
      }

      // Default Entra claims (email without a verification claim) are refused.
      reject(yield* complete({ sub: "username-only", extra: entra }), "claims")
      reject(yield* complete({ sub: "no-edov", email: "person@example.test", extra: entra }), "claims")
      reject(
        yield* complete({ sub: "edov-false", email: "person@example.test", extra: { ...entra, xms_edov: false } }),
        "claims",
      )
      reject(
        yield* complete({ sub: "edov-string", email: "person@example.test", extra: { ...entra, xms_edov: "true" } }),
        "claims",
      )
      reject(
        yield* complete({
          sub: "explicitly-unverified",
          email: "person@example.test",
          extra: { ...entra, xms_edov: true, email_verified: false },
        }),
        "claims",
      )
      // xms_edov does not bypass domain admission.
      reject(
        yield* complete({ sub: "outside-domain", email: "person@outside.test", extra: { ...entra, xms_edov: true } }),
        "domain",
      )

      const success = yield* complete({
        sub: "entra-user",
        email: "person@example.test",
        extra: { ...entra, xms_edov: true },
      })
      expect(success.status).toBe(303)
      const session = cookie(success, "bm_local_auth")
      expect(session).toBeDefined()
      const client = ByMorning.make({ baseUrl: app.origin.href, headers: { cookie: session! } })
      expect(yield* Effect.tryPromise(() => client.workspace.list())).toHaveLength(1)
    }).pipe(Effect.scoped),
    { signal },
  )
})
