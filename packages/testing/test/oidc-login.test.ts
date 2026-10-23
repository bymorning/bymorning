import { ByMorning } from "@bymorning/client"
import { Effect } from "effect"
import { expect, test } from "vitest"
import { start } from "../../server/test/oidc-idp.js"
import { TestApp } from "../src/application.js"
import { AuthScenario } from "../src/scenario/auth.js"

const cookie = (response: Response, name: string) =>
  response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${name}=`))
    ?.split(";", 1)[0]

test("authenticates through a configured OIDC provider", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* Effect.acquireRelease(
          Effect.tryPromise(() => start()),
          (fixture) => Effect.promise(() => fixture.close()).pipe(Effect.orDie),
        )
        const app = yield* TestApp.make({ allowedEmailDomains: ["example.test"] })
        // OIDC providers are Auth Providers selected by `?provider=`; a bare
        // /auth/login is Local Login.
        const provider = yield* AuthScenario.createProvider(app, {
          fixture,
          displayName: "Okta",
          kind: "okta",
          domains: ["example.test"],
        })

        const login = yield* Effect.tryPromise(() =>
          fetch(new URL(`/auth/login?provider=${provider.id}&redirect=/`, app.origin), { redirect: "manual" }),
        )
        expect(login.status).toBe(302)
        const location = login.headers.get("location")
        const attempt = cookie(login, "bm_local_attempt")
        expect(location).not.toBeNull()
        expect(new URL(location!).origin).toBe(fixture.issuer.origin)
        expect(attempt).toBeDefined()

        const issued = yield* Effect.tryPromise(() =>
          fixture.authorize(new URL(location!), {
            sub: "okta-user-1",
            email: "person@example.test",
            extra: { email_verified: true },
          }),
        )
        const callback = yield* Effect.tryPromise(() =>
          fetch(new URL(issued.redirect.pathname + issued.redirect.search, app.origin), {
            redirect: "manual",
            headers: { cookie: attempt! },
          }),
        )
        expect(callback.status).toBe(303)
        expect(new URL(callback.headers.get("location")!).pathname).toBe("/")
        const account = cookie(callback, "bm_local_auth")
        expect(account).toBeDefined()

        const client = ByMorning.make({ baseUrl: app.origin.href, headers: { cookie: account! } })
        expect(yield* Effect.tryPromise(() => client.workspace.list())).toHaveLength(1)

        const rejected = yield* Effect.tryPromise(() =>
          fetch(new URL(`/auth/login?provider=${provider.id}&redirect=/`, app.origin), { redirect: "manual" }),
        )
        const rejectedLocation = rejected.headers.get("location")
        const rejectedAttempt = cookie(rejected, "bm_local_attempt")
        expect(rejected.status).toBe(302)
        expect(rejectedLocation).not.toBeNull()
        expect(rejectedAttempt).toBeDefined()
        const rejectedIssued = yield* Effect.tryPromise(() =>
          fixture.authorize(new URL(rejectedLocation!), {
            sub: "okta-user-2",
            email: "person@outside.test",
            extra: { email_verified: true },
          }),
        )
        const failed = yield* Effect.tryPromise(() =>
          fetch(new URL(rejectedIssued.redirect.pathname + rejectedIssued.redirect.search, app.origin), {
            redirect: "manual",
            headers: { cookie: rejectedAttempt! },
          }),
        )
        expect(failed.status).toBe(303)
        expect(
          new URL(failed.headers.get("location")!).pathname + new URL(failed.headers.get("location")!).search,
        ).toBe("/login?auth=failed&reason=domain")
      }),
    ),
    { signal },
  )
})
