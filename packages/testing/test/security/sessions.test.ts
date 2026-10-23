/**
 * Login Session and OAuth grant lifecycle (NIST 3.1.10/3.1.11, OAuth 2.0
 * Security BCP): durable server-side Login Sessions with idle and absolute
 * bounds, logout and self-service revocation, legacy v1 cookie refusal, and
 * OAuth refresh expiry with rotation reuse detection. Each test carries a
 * stable [SEC-SESS-nn] identifier for compliance reports.
 */
import { Auth } from "@bymorning/core/auth"
import { Database, LoginSessionTable, OAuthGrantTable } from "@bymorning/core/database"
import { OAuth } from "@bymorning/core/oauth"
import { Account } from "@bymorning/schema/account"
import { Auth as AuthSchema } from "@bymorning/schema/auth"
import { OAuthAuthorization } from "@bymorning/schema/oauth-authorization"
import type { Workspace } from "@bymorning/schema/workspace"
import { and, eq } from "drizzle-orm"
import { Effect } from "effect"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { expect, test } from "vitest"
import { TestApp } from "../../src/application.js"

/** The fixture cookie policy is WebCookie.local. */
const sessionCookieName = "bm_local_auth"
const attemptCookieName = "bm_local_attempt"

const cookiePairs = (response: Response): ReadonlyArray<string> =>
  response.headers
    .getSetCookie()
    .map((line) => line.split(";", 1)[0]?.trim() ?? "")
    .filter((pair) => pair !== "" && pair.includes("="))

/**
 * Follow the real local login over raw HTTP and return the session cookie
 * pair, so the exact credential can be replayed after server-side changes.
 */
const rawLogin = (app: TestApp.Interface) =>
  Effect.tryPromise(async () => {
    const start = await fetch(new URL("/auth/login", app.origin), { redirect: "manual" })
    const location = start.headers.get("location")
    if (start.status !== 302 || location === null) throw new Error("Local login did not redirect")
    const attempt = cookiePairs(start)
      .filter((pair) => pair.startsWith(`${attemptCookieName}=`))
      .join("; ")
    if (attempt === "") throw new Error("Local login did not set an attempt cookie")
    const callback = new URL(location)
    const complete = await fetch(new URL(callback.pathname + callback.search, app.origin), {
      redirect: "manual",
      headers: { cookie: attempt },
    })
    const session = cookiePairs(complete).find((pair) => pair.startsWith(`${sessionCookieName}=`))
    if (complete.status !== 303 || session === undefined) throw new Error("Local login did not establish a session")
    return session
  })

/** Raw authenticated account read: 200 while the session is accepted, 401 once refused. */
const probe = (app: TestApp.Interface, cookie: string) =>
  Effect.tryPromise(async () => {
    const response = await fetch(new URL("/api/account", app.origin), { headers: { cookie } })
    return response.status
  })

const sessionRows = (app: TestApp.Interface, accountID: Account.ID) =>
  app
    .process(
      Database.Service.use((database) =>
        database.use("SessionsTest.rows", (db) =>
          db.select().from(LoginSessionTable).where(eq(LoginSessionTable.accountId, accountID)),
        ),
      ),
    )
    .pipe(Effect.orDie)

const grantRows = (app: TestApp.Interface, accountID: Account.ID) =>
  app
    .process(
      Database.Service.use((database) =>
        database.use("SessionsTest.grants", (db) =>
          db.select().from(OAuthGrantTable).where(eq(OAuthGrantTable.accountId, accountID)),
        ),
      ),
    )
    .pipe(Effect.orDie)

/** Assert the SDK call fails with the expected typed error tag. */
const refused = (tag: string, operation: () => Promise<unknown>) =>
  Effect.gen(function* () {
    const error = yield* Effect.tryPromise(operation).pipe(Effect.flip)
    expect(error.cause ?? error).toMatchObject({ _tag: tag })
  })

const unauthorized = (operation: () => Promise<unknown>) => refused("UnauthorizedError", operation)

/**
 * Establish one real OAuth grant through the public authorization-code flow:
 * dynamic registration, consent approval as the signed-in member, and the PKCE
 * token exchange.
 */
const grantTokens = Effect.fn("SessionsTest.grantTokens")(function* (
  app: TestApp.Interface,
  workspaceID: Workspace.ID,
  clientName = "Sessions fixture",
) {
  return yield* Effect.tryPromise(async () => {
    const redirect = "http://127.0.0.1/callback"
    const registration = await fetch(new URL("/oauth/register", app.origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: [redirect], client_name: clientName }),
    })
    if (registration.status !== 201) throw new Error("OAuth registration failed")
    const { client_id } = (await registration.json()) as { client_id: string }
    const verifier = randomBytes(32).toString("base64url")
    const authorize = new URL("/oauth/authorize", app.origin)
    authorize.search = new URLSearchParams({
      response_type: "code",
      client_id,
      redirect_uri: redirect,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString()
    const authorization = await fetch(authorize, { redirect: "manual" })
    const location = authorization.headers.get("location")
    if (authorization.status !== 302 || location === null) throw new Error("OAuth authorize did not redirect")
    const requestID = new URL(location).searchParams.get("request")
    if (requestID === null) throw new Error("OAuth authorize did not issue a request")
    const approval = await app.client["api.oauth"].approve({
      requestID: OAuthAuthorization.ID.make(requestID),
      workspaceID,
    })
    const code = new URL(approval.url).searchParams.get("code")
    if (code === null) throw new Error("OAuth approval did not issue a code")
    const exchange = await fetch(new URL("/oauth/token", app.origin), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        client_id,
        redirect_uri: redirect,
      }),
    })
    if (exchange.status !== 200) throw new Error(`OAuth code exchange failed: ${exchange.status}`)
    const tokens = (await exchange.json()) as { access_token: string; refresh_token: string; expires_in: number }
    return { clientID: client_id, accessToken: tokens.access_token, refreshToken: tokens.refresh_token }
  })
})

interface RefreshResult {
  readonly status: number
  readonly error?: string
  readonly accessToken?: string
  readonly refreshToken?: string
}

/** POST the real refresh_token grant to the token endpoint. */
const refreshGrant = (app: TestApp.Interface, clientID: string, refreshToken: string) =>
  Effect.tryPromise(async (): Promise<RefreshResult> => {
    const response = await fetch(new URL("/oauth/token", app.origin), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientID }),
    })
    const body = (await response.json()) as { error?: string; access_token?: string; refresh_token?: string }
    return {
      status: response.status,
      ...(body.error === undefined ? {} : { error: body.error }),
      ...(body.access_token === undefined ? {} : { accessToken: body.access_token }),
      ...(body.refresh_token === undefined ? {} : { refreshToken: body.refresh_token }),
    }
  })

/**
 * Hand-build a correctly encrypted and authenticated v1 Login Session cookie
 * under the fixture's known key: the hardened upgrade path must refuse it even
 * though the envelope itself is valid.
 */
const v1SessionCookie = (key: string, accountID: Account.ID) => {
  const nonce = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "base64url"), nonce, { authTagLength: 16 })
  cipher.setAAD(Buffer.from("v1", "utf8"))
  const plaintext = Buffer.from(
    JSON.stringify({
      version: 1,
      type: "session",
      accountID,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }),
    "utf8",
  )
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const envelope = {
    version: "v1",
    nonce: nonce.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  }
  return `${sessionCookieName}=${Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url")}`
}

test("[SEC-SESS-01] logout revokes the Login Session server-side; a replayed cookie is refused", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      yield* app.login()
      const cookie = yield* rawLogin(app)
      expect(yield* probe(app, cookie)).toBe(200)

      const logout = yield* Effect.tryPromise(() =>
        fetch(new URL("/auth/logout", app.origin), {
          method: "POST",
          headers: { cookie, origin: "http://localhost:3000" },
        }),
      )
      expect(logout.status).toBe(204)

      // The captured cookie is cryptographically valid but server-side revoked.
      expect(yield* probe(app, cookie)).toBe(401)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-SESS-02] the idle timeout refuses an inactive session and activity touches are throttled", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const owner = yield* app.login()
      const accountID = owner.properties.accountID
      const before = yield* sessionRows(app, accountID)
      const cookie = yield* rawLogin(app)
      const after = yield* sessionRows(app, accountID)
      const row = after.find((candidate) => !before.some((existing) => existing.id === candidate.id))
      if (row === undefined) throw new Error("raw login did not create a Login Session record")

      // Within 60 seconds of issuance the touch is throttled away entirely.
      expect(yield* probe(app, cookie)).toBe(200)
      const [untouched] = yield* sessionRows(app, accountID).pipe(
        Effect.map((rows) => rows.filter((candidate) => candidate.id === row.id)),
      )
      expect(untouched?.timeTouched.getTime()).toBe(row.timeTouched.getTime())
      expect(untouched?.timeIdleExpires.getTime()).toBe(row.timeIdleExpires.getTime())

      // Past the throttle window, activity extends the idle bound.
      yield* app
        .process(
          Database.Service.use((database) =>
            database.use("SessionsTest.ageTouch", (db) =>
              db
                .update(LoginSessionTable)
                .set({ timeTouched: new Date(Date.now() - 61_000) })
                .where(eq(LoginSessionTable.id, row.id)),
            ),
          ),
        )
        .pipe(Effect.orDie)
      expect(yield* probe(app, cookie)).toBe(200)
      const [touched] = yield* sessionRows(app, accountID).pipe(
        Effect.map((rows) => rows.filter((candidate) => candidate.id === row.id)),
      )
      expect(touched?.timeTouched.getTime()).toBeGreaterThan(Date.now() - 5_000)
      expect(touched?.timeIdleExpires.getTime()).toBeGreaterThan(row.timeIdleExpires.getTime())

      // An idle-expired record refuses the replayed cookie; the owner's other
      // session in the default client jar is unaffected.
      yield* app
        .process(
          Database.Service.use((database) =>
            database.use("SessionsTest.ageIdle", (db) =>
              db
                .update(LoginSessionTable)
                .set({ timeIdleExpires: new Date(Date.now() - 1_000) })
                .where(eq(LoginSessionTable.id, row.id)),
            ),
          ),
        )
        .pipe(Effect.orDie)
      expect(yield* probe(app, cookie)).toBe(401)
      yield* Effect.tryPromise(() => app.client.account.get())
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-SESS-03] the absolute lifetime bound is enforced from the durable record", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const owner = yield* app.login()
      const before = yield* sessionRows(app, owner.properties.accountID)
      const cookie = yield* rawLogin(app)
      const after = yield* sessionRows(app, owner.properties.accountID)
      const row = after.find((candidate) => !before.some((existing) => existing.id === candidate.id))
      if (row === undefined) throw new Error("raw login did not create a Login Session record")
      expect(yield* probe(app, cookie)).toBe(200)

      // The signed payload still carries 12 h of absolute lifetime; the record
      // is authoritative and refuses the replay.
      yield* app
        .process(
          Database.Service.use((database) =>
            database.use("SessionsTest.ageAbsolute", (db) =>
              db
                .update(LoginSessionTable)
                .set({ timeExpires: new Date(Date.now() - 1_000), timeIdleExpires: new Date(Date.now() + 60_000) })
                .where(eq(LoginSessionTable.id, row.id)),
            ),
          ),
        )
        .pipe(Effect.orDie)
      expect(yield* probe(app, cookie)).toBe(401)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-SESS-04] Auth.revokeAll ends every Login Session of the Account", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const owner = yield* app.login()
      const first = yield* rawLogin(app)
      const second = yield* rawLogin(app)
      expect(yield* probe(app, first)).toBe(200)
      expect(yield* probe(app, second)).toBe(200)

      yield* app.process(Auth.Service.use((auth) => auth.revokeAll(owner.properties.accountID)))

      expect(yield* probe(app, first)).toBe(401)
      expect(yield* probe(app, second)).toBe(401)
      yield* unauthorized(() => app.client.account.get())
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-SESS-05] a version 1 Login Session cookie is refused even when correctly signed", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const key = Buffer.alloc(32, 23).toString("base64url")
      const app = yield* TestApp.make({ cookieKey: key })
      const owner = yield* app.login()
      // The real v2 cookie authenticates against the same account.
      yield* Effect.tryPromise(() => app.client.account.get())
      const legacy = v1SessionCookie(key, owner.properties.accountID)
      expect(yield* probe(app, legacy)).toBe(401)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-SESS-06] an Account lists and revokes its own Login Sessions, never another Account's", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      yield* app.login()
      const second = app.clientFor()
      yield* app.login(second)

      const sessions = yield* Effect.tryPromise(() => app.client.account.session.list())
      expect(sessions).toHaveLength(2)
      expect(sessions.filter((session) => session.current)).toHaveLength(1)
      expect(sessions.every((session) => session.id.startsWith("lgs_"))).toBe(true)
      const other = sessions.find((session) => !session.current)
      if (other === undefined) throw new Error("expected the second login to appear in the session list")

      yield* Effect.tryPromise(() => app.client.account.session.revoke({ sessionID: other.id }))
      yield* unauthorized(() => second.account.get())
      yield* Effect.tryPromise(() => app.client.account.get())
      expect(yield* Effect.tryPromise(() => app.client.account.session.list())).toHaveLength(1)

      // A second Account's sessions are invisible and unaddressable here.
      const memberClient = app.clientFor()
      yield* app.login(memberClient, {
        subject: AuthSchema.Sub.make("test-member"),
        email: AuthSchema.Email.make("member@bymorning.ai"),
      })
      const memberSessions = yield* Effect.tryPromise(() => memberClient.account.session.list())
      expect(memberSessions).toHaveLength(1)
      const memberSession = memberSessions[0]
      if (memberSession === undefined) throw new Error("member login did not establish a session")
      expect(memberSession.current).toBe(true)
      yield* refused("Auth.NotFoundError", () => app.client.account.session.revoke({ sessionID: memberSession.id }))
      yield* Effect.tryPromise(() => memberClient.account.get())
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-SESS-07] an OAuth refresh token expires at the fixed 30-day bound", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const owner = yield* app.login()
      const grant = yield* grantTokens(app, owner.properties.workspaceID)

      const rotated = yield* refreshGrant(app, grant.clientID, grant.refreshToken)
      expect(rotated.status).toBe(200)
      if (rotated.refreshToken === undefined) throw new Error("refresh did not rotate")

      // Age the grant past its absolute refresh expiry; rotation history is irrelevant.
      yield* app
        .process(
          Database.Service.use((database) =>
            database.use("SessionsTest.ageRefresh", (db) =>
              db
                .update(OAuthGrantTable)
                .set({ timeRefreshExpires: new Date(Date.now() - 1_000) })
                .where(eq(OAuthGrantTable.accountId, owner.properties.accountID)),
            ),
          ),
        )
        .pipe(Effect.orDie)
      const expired = yield* refreshGrant(app, grant.clientID, rotated.refreshToken)
      expect(expired).toMatchObject({ status: 400, error: "invalid_grant" })
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-SESS-08] replaying a rotated-out refresh token revokes the whole grant family", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const owner = yield* app.login()
      const grant = yield* grantTokens(app, owner.properties.workspaceID)

      const rotated = yield* refreshGrant(app, grant.clientID, grant.refreshToken)
      expect(rotated.status).toBe(200)
      if (rotated.refreshToken === undefined || rotated.accessToken === undefined) {
        throw new Error("refresh did not rotate")
      }

      // The superseded token is presented again (theft or replay): family revoked.
      const replay = yield* refreshGrant(app, grant.clientID, grant.refreshToken)
      expect(replay).toMatchObject({ status: 400, error: "invalid_grant" })
      const current = yield* refreshGrant(app, grant.clientID, rotated.refreshToken)
      expect(current).toMatchObject({ status: 400, error: "invalid_grant" })
      expect(yield* grantRows(app, owner.properties.accountID)).toHaveLength(0)
      const resolved = yield* app.process(OAuth.Service.use((oauth) => oauth.resolveAccess(rotated.accessToken!)))
      expect(resolved).toBeUndefined()
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-SESS-09] an Account lists and revokes its own OAuth grants; access dies immediately", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const owner = yield* app.login()
      const grant = yield* grantTokens(app, owner.properties.workspaceID, "Fixture application")

      const grants = yield* Effect.tryPromise(() => app.client.account.grant.list())
      expect(grants).toHaveLength(1)
      expect(grants[0]).toMatchObject({ clientID: grant.clientID, clientName: "Fixture application" })
      expect(Date.parse(grants[0]!.expiresAt) - Date.now()).toBeGreaterThan(29 * 24 * 3_600_000)
      expect(yield* app.process(OAuth.Service.use((oauth) => oauth.resolveAccess(grant.accessToken)))).toMatchObject({
        accountID: owner.properties.accountID,
      })

      const grantID = grants[0]!.id
      yield* Effect.tryPromise(() => app.client.account.grant.revoke({ grantID }))
      expect(yield* Effect.tryPromise(() => app.client.account.grant.list())).toHaveLength(0)
      expect(yield* app.process(OAuth.Service.use((oauth) => oauth.resolveAccess(grant.accessToken)))).toBeUndefined()
      expect(yield* refreshGrant(app, grant.clientID, grant.refreshToken)).toMatchObject({
        status: 400,
        error: "invalid_grant",
      })
      yield* refused("OAuth.NotFoundError", () => app.client.account.grant.revoke({ grantID }))

      // Grants are Account-scoped: another Account cannot see or revoke them.
      const otherGrant = yield* grantTokens(app, owner.properties.workspaceID, "Second application")
      const memberClient = app.clientFor()
      yield* app.login(memberClient, {
        subject: AuthSchema.Sub.make("test-member"),
        email: AuthSchema.Email.make("member@bymorning.ai"),
      })
      expect(yield* Effect.tryPromise(() => memberClient.account.grant.list())).toHaveLength(0)
      const remaining = yield* Effect.tryPromise(() => app.client.account.grant.list())
      expect(remaining).toHaveLength(1)
      yield* refused("OAuth.NotFoundError", () => memberClient.account.grant.revoke({ grantID: remaining[0]!.id }))
      expect(yield* refreshGrant(app, otherGrant.clientID, otherGrant.refreshToken)).toMatchObject({ status: 200 })
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-SESS-10] OAuth.revokeAll ends every grant of the Account", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const owner = yield* app.login()
      const first = yield* grantTokens(app, owner.properties.workspaceID, "First application")
      const second = yield* grantTokens(app, owner.properties.workspaceID, "Second application")
      expect(yield* grantRows(app, owner.properties.accountID)).toHaveLength(2)

      yield* app.process(OAuth.Service.use((oauth) => oauth.revokeAll(owner.properties.accountID)))

      expect(yield* Effect.tryPromise(() => app.client.account.grant.list())).toHaveLength(0)
      expect(yield* app.process(OAuth.Service.use((oauth) => oauth.resolveAccess(first.accessToken)))).toBeUndefined()
      expect(yield* app.process(OAuth.Service.use((oauth) => oauth.resolveAccess(second.accessToken)))).toBeUndefined()
      expect(yield* refreshGrant(app, first.clientID, first.refreshToken)).toMatchObject({
        status: 400,
        error: "invalid_grant",
      })
    }).pipe(Effect.scoped),
    { signal },
  )
})
