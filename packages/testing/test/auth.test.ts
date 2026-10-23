import { AuthProvider } from "@bymorning/core/auth-provider"
import { Auth as AuthSchema } from "@bymorning/schema/auth"
import { AuthProvider as AuthProviderSchema } from "@bymorning/schema/auth-provider"
import { Effect, Schema } from "effect"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "vitest"
import { start } from "../../server/test/oidc-idp.js"
import { TestApp } from "../src/application.js"
import { AuthScenario } from "../src/scenario/auth.js"

const attemptCookie = "bm_local_attempt"

const pairValue = (pair: string) => pair.slice(pair.indexOf("=") + 1)

/** Open a real OIDC login through HTTP: 302 to the issuer plus an attempt cookie. */
const openOidc = (app: TestApp.Interface, providerID: AuthProviderSchema.ID) =>
  Effect.tryPromise(async () => {
    const start = await fetch(new URL(`/auth/login?provider=${providerID}`, app.origin), { redirect: "manual" })
    const location = start.headers.get("location")
    if (start.status !== 302 || location === null) throw new Error("OIDC login did not redirect to the issuer")
    const attempt = start.headers
      .getSetCookie()
      .map((line) => line.split(";", 1)[0]?.trim() ?? "")
      .find((pair) => pair.startsWith(`${attemptCookie}=`))
    if (attempt === undefined || pairValue(attempt) === "")
      throw new Error("OIDC login did not set an attempt cookie")
    return { location: new URL(location), attempt }
  })

/** Complete a real OIDC callback through HTTP, reporting the redirect and any valued cookies. */
const completeCallback = (app: TestApp.Interface, redirect: URL, attempt: string) =>
  Effect.tryPromise(async () => {
    const callback = await fetch(new URL(`${redirect.pathname}${redirect.search}`, app.origin), {
      redirect: "manual",
      headers: { cookie: attempt },
    })
    const location = callback.headers.get("location")
    if (callback.status !== 303 || location === null) throw new Error("OIDC callback did not redirect")
    const session = callback.headers
      .getSetCookie()
      .map((line) => line.split(";", 1)[0]?.trim() ?? "")
      .filter((pair) => pair.includes("=") && pairValue(pair) !== "")
    return { location: new URL(location), session }
  })

/** Expected login failures redirect with one coarse reason and never establish a session. */
const expectFailure = (
  result: { readonly location: URL; readonly session: ReadonlyArray<string> },
  reason: AuthScenario.FailureReason,
) => {
  expect(result.location.pathname + result.location.search).toBe(`/login?auth=failed&reason=${reason}`)
  expect(result.session).toEqual([])
}

test("local login works through real HTTP when composition provides local identity", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        // The TestApp composition installs Local Login on its loopback origin:
        // auth.method reports it and opening without a provider redirects (a
        // local-disabled composition would answer 503 instead).
        expect(yield* Effect.tryPromise(() => app.client.auth.method())).toMatchObject({
          state: "ready",
          local: true,
        })
        const start = yield* Effect.tryPromise(() =>
          fetch(new URL("/auth/login", app.origin), { redirect: "manual" }),
        )
        expect(start.status).toBe(302)
        expect(new URL(start.headers.get("location")!).pathname).toBe("/auth/callback")
        const owner = yield* AuthScenario.loginLocal(app)
        expect(yield* Effect.tryPromise(() => app.client.account.get())).toEqual({
          id: owner.properties.accountID,
          email: "owner@bymorning.ai",
        })
      }),
    ),
    { signal },
  )
})

test("two OIDC providers keep separate accounts while unverified email and stale revisions fail closed", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* Effect.acquireRelease(
          Effect.tryPromise(() => start()),
          (fixture) => Effect.promise(() => fixture.close()),
        )
        const app = yield* TestApp.make()
        const providerA = yield* AuthScenario.createProvider(app, { fixture, displayName: "Fixture A" })
        const providerB = yield* AuthScenario.createProvider(app, { fixture, displayName: "Fixture B" })
        expect(providerB.id).not.toBe(providerA.id)

        // Same fixture issuer, different subs, same email: no email merge.
        const clientA = app.clientFor()
        const clientB = app.clientFor()
        const verified = { email_verified: true } as const
        const email = "shared@bymorning.ai"
        const firstA = yield* AuthScenario.loginOidc(
          app,
          fixture,
          providerA.id,
          { sub: "shared-one", email, extra: { ...verified } },
          clientA,
        )
        const firstB = yield* AuthScenario.loginOidc(
          app,
          fixture,
          providerB.id,
          { sub: "shared-two", email, extra: { ...verified } },
          clientB,
        )
        expect(firstA.account).toEqual({ id: firstA.account.id, email })
        expect(firstB.account.id).toBeTruthy()
        expect(firstB.account.id).not.toBe(firstA.account.id)
        const repeatA = yield* AuthScenario.loginOidc(
          app,
          fixture,
          providerA.id,
          { sub: "shared-one", email, extra: { ...verified } },
          clientA,
        )
        expect(repeatA.account.id).toBe(firstA.account.id)

        // email_verified false is rejected: failure redirect, no session cookie.
        const unverified = yield* openOidc(app, providerA.id)
        const denied = yield* Effect.tryPromise(() =>
          fixture.authorize(unverified.location, {
            sub: "unverified",
            email: "unverified@bymorning.ai",
            extra: { email_verified: false },
          }),
        )
        expectFailure(yield* completeCallback(app, denied.redirect, unverified.attempt), "claims")

        // Stale revision: the attempt opens at revision 1, an update bumps the
        // provider to revision 2 before the callback completes.
        const opened = yield* openOidc(app, providerB.id)
        const updated = yield* app.process(
          AuthProvider.Service.use((providers) =>
            providers.update(
              Schema.decodeUnknownSync(AuthProviderSchema.Update)({
                id: providerB.id,
                revision: providerB.revision,
                displayName: "Fixture B v2",
                kind: "custom",
                domains: ["bymorning.ai"],
                status: "enabled",
              }),
            ),
          ),
        )
        expect(updated.revision).toBe(2)
        const issued = yield* Effect.tryPromise(() =>
          fixture.authorize(opened.location, { sub: "shared-two", email, extra: { ...verified } }),
        )
        expectFailure(yield* completeCallback(app, issued.redirect, opened.attempt), "provider")
      }),
    ),
    { signal },
  )
}, 120_000)

test("auth provider administration requires admin; the setup token travels in the body, never the URL", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* Effect.acquireRelease(
          Effect.tryPromise(() => start()),
          (fixture) => Effect.promise(() => fixture.close()),
        )
        const app = yield* TestApp.make()
        const admin = yield* app.login()
        expect(admin.properties.role).toBe("admin")
        yield* Effect.tryPromise(() =>
          app.client.user.invite({ email: AuthSchema.Email.make("member@bymorning.ai"), role: "member" }),
        )
        const memberClient = app.clientFor()
        const member = yield* app.login(memberClient, {
          subject: AuthSchema.Sub.make("test-member"),
          email: AuthSchema.Email.make("member@bymorning.ai"),
        })
        expect(member.properties.role).toBe("member")

        const value = {
          displayName: "Admin OIDC",
          kind: "custom" as const,
          domains: ["bymorning.ai"] as const,
          issuer: fixture.issuer.href,
          clientID: fixture.clientID,
          clientSecret: fixture.clientSecret,
        }
        // The generated SDK decodes ForbiddenError only from the 403 mapping,
        // so this is the member 403 over real HTTP.
        const denied = yield* Effect.tryPromise(() =>
          memberClient["api.auth-provider"].authProvider.create({
            id: AuthProviderSchema.ID.create(),
            ...value,
          }),
        ).pipe(Effect.flip)
        expect(denied.cause).toMatchObject({ _tag: "ForbiddenError" })
        const created = yield* Effect.tryPromise(() =>
          app.client["api.auth-provider"].authProvider.create({
            id: AuthProviderSchema.ID.create(),
            ...value,
          }),
        )
        expect(created).toMatchObject({ revision: 1, status: "enabled" })

        // The installation minted its setup token at boot and stores only its
        // hash; read the reveal through the owner-read-only setup-token file
        // (no test HTTP endpoint mints it).
        const token = (yield* Effect.tryPromise(() =>
          readFile(join(app.directory, "setup-token"), "utf8"),
        )).trim()
        expect(token.length).toBeGreaterThan(32)

        // A token in the URL is not a contract: no GET inspect endpoint exists.
        const inUrl = yield* Effect.tryPromise(() => fetch(new URL(`/auth/inspect?token=${token}`, app.origin)))
        expect(inUrl.status).not.toBe(200)
        // The token belongs in the POST body; a wrong one is forbidden.
        const wrong = yield* Effect.tryPromise(() => app.client.auth.inspect({ token: "wrong" })).pipe(Effect.flip)
        expect(wrong.cause).toMatchObject({ _tag: "ForbiddenError" })
        const inspected = yield* Effect.tryPromise(() => app.client.auth.inspect({ token: token! }))
        expect(inspected.map((info) => info.id)).toContain(created.id)
        const viaSetup = yield* Effect.tryPromise(() =>
          app.client.auth.setup({
            payload: { type: "create", token: token!, value: { ...value, id: AuthProviderSchema.ID.create() } },
          }),
        )
        expect(viaSetup).toMatchObject({ revision: 1, status: "enabled" })
      }),
    ),
    { signal },
  )
}, 120_000)

test("each Auth Provider admits only its own email domains", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* Effect.acquireRelease(
          Effect.tryPromise(() => start()),
          (fixture) => Effect.promise(() => fixture.close()),
        )
        // The host list admits nothing; admission must come from the Auth Provider.
        const app = yield* TestApp.make({ allowedEmailDomains: [] })
        const agency = yield* AuthScenario.createProvider(app, {
          fixture,
          displayName: "Agency",
          domains: ["agency.example"],
        })
        const partner = yield* AuthScenario.createProvider(app, {
          fixture,
          displayName: "Partner",
          domains: ["partner.example"],
        })
        const verified = { email_verified: true } as const

        const admitted = yield* AuthScenario.loginOidc(
          app,
          fixture,
          agency.id,
          { sub: "agency-1", email: "person@agency.example", extra: { ...verified } },
          app.clientFor(),
        )
        expect(admitted.account.email).toBe("person@agency.example")

        // Same email domain through the other provider, which does not admit it.
        const crossed = yield* openOidc(app, partner.id)
        const issued = yield* Effect.tryPromise(() =>
          fixture.authorize(crossed.location, {
            sub: "agency-2",
            email: "other@agency.example",
            extra: { ...verified },
          }),
        )
        expectFailure(yield* completeCallback(app, issued.redirect, crossed.attempt), "domain")

        // A domain no provider admits fails even though the fixture verified it.
        const outside = yield* openOidc(app, agency.id)
        const outsider = yield* Effect.tryPromise(() =>
          fixture.authorize(outside.location, {
            sub: "outsider",
            email: "person@bymorning.ai",
            extra: { ...verified },
          }),
        )
        expectFailure(yield* completeCallback(app, outsider.redirect, outside.attempt), "domain")
      }),
    ),
    { signal },
  )
}, 120_000)
