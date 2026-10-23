/** Reusable Auth Provider setup and browser login flows for application tests. */
export * as AuthScenario from "./auth.js"

import type { ByMorningClient } from "@bymorning/client"
import { AuthProvider } from "@bymorning/core/auth-provider"
import { Auth } from "@bymorning/schema/auth"
import { Effect, Schema } from "effect"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { TestApp } from "../application.js"

/** Coarse reason the login callback reports on `/login?auth=failed`. */
export type FailureReason = Auth.FailureReason

/** Verified identity the OIDC fixture authorizes at the issuer. */
export interface IdentityToken {
  readonly sub: string
  readonly email?: string
  readonly extra?: Record<string, unknown>
}

/** Issuer redirect issued by the OIDC fixture. */
export interface OidcIssued {
  readonly code: string
  readonly redirect: URL
}

/** Structural OIDC fixture surface; `packages/server/test/oidc-idp.ts` satisfies this. */
export interface OidcFixture {
  readonly issuer: URL
  readonly clientID: string
  readonly clientSecret: string
  readonly authorize: (url: URL, identity: IdentityToken) => Promise<OidcIssued>
  readonly close: () => Promise<void>
}

const cookiePairs = (response: Response): ReadonlyArray<string> =>
  response.headers
    .getSetCookie()
    .map((line) => line.split(";", 1)[0]?.trim() ?? "")
    .filter((pair) => pair !== "" && pair.includes("="))

const hasValue = (pair: string) => pair.slice(pair.indexOf("=") + 1) !== ""

/** Seed one enabled Auth Provider bound to the fixture issuer through the public authority. */
export const createProvider = Effect.fn("AuthScenario.createProvider")(function* (
  app: TestApp.Interface,
  input: {
    readonly fixture: OidcFixture
    readonly displayName?: string
    readonly kind?: AuthProvider.Create["kind"]
    readonly domains?: readonly string[]
  },
) {
  const create = yield* Schema.decodeUnknownEffect(AuthProvider.Create)({
    id: AuthProvider.ID.create(),
    displayName: input.displayName ?? "Fixture OIDC",
    kind: input.kind ?? "custom",
    issuer: input.fixture.issuer.href,
    clientID: input.fixture.clientID,
    clientSecret: input.fixture.clientSecret,
    domains: input.domains ?? ["bymorning.ai"],
  }).pipe(Effect.mapError((cause) => new TestApp.RequestError({ message: "Auth Provider input is invalid", cause })))
  return yield* app.process(AuthProvider.Service.use((providers) => providers.create(create))).pipe(
    Effect.mapError((cause) => new TestApp.RequestError({ message: "Auth Provider creation failed", cause })),
  )
})

/** Follow the real OIDC browser flow for one Auth Provider, then verify the session. */
export const loginOidc = Effect.fn("AuthScenario.loginOidc")(function* (
  app: TestApp.Interface,
  fixture: OidcFixture,
  providerID: AuthProvider.ID,
  identity: IdentityToken,
  client?: ByMorningClient,
) {
  const cookie = yield* Effect.tryPromise({
    try: async () => {
      const login = new URL("/auth/login", app.origin)
      login.searchParams.set("provider", providerID)
      const start = await fetch(login, { redirect: "manual" })
      const location = start.headers.get("location")
      if (start.status !== 302 || location === null) throw new Error("OIDC login did not redirect to the issuer")
      const attempt = cookiePairs(start).join("; ")
      if (attempt === "") throw new Error("OIDC login did not set an attempt cookie")
      const issued = await fixture.authorize(new URL(location), identity)
      // The fixture returns the app callback with code and state; reach the
      // same actual handler directly, as the local web proxy does.
      const callback = new URL(`${issued.redirect.pathname}${issued.redirect.search}`, app.origin)
      const complete = await fetch(callback, { redirect: "manual", headers: { cookie: attempt } })
      const established = cookiePairs(complete)
        .filter(hasValue)
        .join("; ")
      if (complete.status !== 303 || complete.headers.get("location") === null || established === "")
        throw new Error("OIDC callback did not establish a session")
      return established
    },
    catch: (cause) => new TestApp.RequestError({ message: "OIDC login failed", cause }),
  })
  const account = yield* Effect.tryPromise({
    try: () => (client ?? app.client).account.get({ headers: { cookie } }),
    catch: (cause) => new TestApp.RequestError({ message: "OIDC session verification failed", cause }),
  })
  return { cookie, account }
})

/**
 * Follow the real OIDC browser flow for one Auth Provider without requiring
 * success: the callback's redirect, its `reason` when it failed, and any
 * established session cookies.
 */
export const attemptOidc = Effect.fn("AuthScenario.attemptOidc")(function* (
  app: TestApp.Interface,
  fixture: OidcFixture,
  providerID: AuthProvider.ID,
  identity: IdentityToken,
) {
  return yield* Effect.tryPromise({
    try: async () => {
      const login = new URL("/auth/login", app.origin)
      login.searchParams.set("provider", providerID)
      const start = await fetch(login, { redirect: "manual" })
      const location = start.headers.get("location")
      if (start.status !== 302 || location === null) throw new Error("OIDC login did not redirect to the issuer")
      const attempt = cookiePairs(start).join("; ")
      const issued = await fixture.authorize(new URL(location), identity)
      const callback = new URL(`${issued.redirect.pathname}${issued.redirect.search}`, app.origin)
      const complete = await fetch(callback, { redirect: "manual", headers: { cookie: attempt } })
      const redirect = complete.headers.get("location")
      if (complete.status !== 303 || redirect === null) throw new Error("OIDC callback did not redirect")
      const target = new URL(redirect, app.origin)
      const failed = target.pathname === "/login" && target.searchParams.get("auth") === "failed"
      return {
        redirect: target,
        reason: failed ? (target.searchParams.get("reason") ?? undefined) : undefined,
        session: cookiePairs(complete).filter(hasValue),
      }
    },
    catch: (cause) => new TestApp.RequestError({ message: "OIDC attempt failed", cause }),
  })
})

/** Read the Setup token the Application revealed in its owner-read-only file. */
export const setupToken = Effect.fn("AuthScenario.setupToken")(function* (app: TestApp.Interface) {
  const token = yield* Effect.tryPromise({
    try: () => readFile(join(app.directory, "setup-token"), "utf8"),
    catch: (cause) => new TestApp.RequestError({ message: "Setup token is unavailable", cause }),
  })
  return token.trim()
})

/** Log in through the existing local flow with no provider query. */
export const loginLocal = Effect.fn("AuthScenario.loginLocal")(function* (
  app: TestApp.Interface,
  client?: ByMorningClient,
) {
  return yield* app.login(client ?? app.client)
})

/**
 * Invite a genuine second account as a Workspace member through the public User
 * authority, and sign it in on its own SDK client. Local Login then admits that
 * identity, so a browser that opens /login without a session becomes the member.
 */
export const loginMember = Effect.fn("AuthScenario.loginMember")(function* (app: TestApp.Interface) {
  const email = Auth.Email.make("member@bymorning.ai")
  yield* Effect.tryPromise({
    try: () => app.client.user.invite({ email, role: "member" }),
    catch: (cause) => new TestApp.RequestError({ message: "Member invitation failed", cause }),
  })
  const client = app.clientFor()
  const member = yield* app.login(client, { subject: Auth.Sub.make("test-member"), email })
  return { client, member }
})
