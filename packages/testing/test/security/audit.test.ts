/**
 * CMMC L2 audit record (NIST 3.3.1 create/retain, 3.3.2 user attribution,
 * 3.3.8 protection of audit information): every security-relevant mutation
 * produces one attributed, hash-chained Audit Entry; reads are gated to
 * Workspace administrators; failed appends roll their mutation back.
 * Each test carries a stable [SEC-AUDIT-nn] identifier for compliance reports.
 */
import { Audit } from "@bymorning/core/audit"
import { Database, AuditEntryTable } from "@bymorning/core/database"
import { Auth } from "@bymorning/schema/auth"
import { OAuthAuthorization } from "@bymorning/schema/oauth-authorization"
import type { Workspace } from "@bymorning/schema/workspace"
import { asc, sql } from "drizzle-orm"
import { Effect } from "effect"
import { createHash, randomBytes } from "node:crypto"
import { expect, test } from "vitest"
import { TestApp } from "../../src/application.js"
import { Chat } from "../../src/scenario/chat.js"
import { ShareScenario } from "../../src/scenario/share.js"

const memberEmail = Auth.Email.make("member@bymorning.ai")

/** Log in the Workspace owner (admin) and one invited member with an independent cookie jar. */
const members = Effect.fn("AuditSpec.members")(function* (app: TestApp.Interface) {
  const admin = yield* app.login()
  yield* Effect.tryPromise(() => app.client.user.invite({ email: memberEmail, role: "member" }))
  const memberClient = app.clientFor()
  const member = yield* app.login(memberClient, { subject: Auth.Sub.make("test-member"), email: memberEmail })
  return { admin, member, memberClient }
})

/** Read Entries through the core authority (no edge authorization), newest first. */
const readAll = (app: TestApp.Interface, input?: Audit.ListInput) =>
  app.process(Audit.Service.use((audit) => audit.list({ ...input, limit: 100 })))

/** Read every stored row in commit order for chain verification. */
const readRows = (app: TestApp.Interface) =>
  app.process(
    Database.Service.use((database) =>
      database.use("AuditSpec.chain", (db) => db.select().from(AuditEntryTable).orderBy(asc(AuditEntryTable.sequence))),
    ),
  )

type Row = Effect.Success<ReturnType<typeof readRows>>[number]

const chained = (row: Row) => ({
  id: row.id,
  occurredAt: row.occurredAt.toISOString(),
  actor: row.actor,
  action: row.action,
  workspaceID: row.workspaceId,
  target: row.target,
  detail: row.detail,
  outcome: row.outcome,
  context:
    row.ip === null && row.user_agent === null
      ? null
      : { ...(row.ip === null ? {} : { ip: row.ip }), ...(row.user_agent === null ? {} : { userAgent: row.user_agent }) },
  chain: row.chain,
  sequence: row.sequence,
})

/** Assert a chain of custody over the whole stream, then return the entries. */
const verified = Effect.fn("AuditSpec.verified")(function* (app: TestApp.Interface) {
  const rows = yield* readRows(app)
  const tampered = Audit.verifyChain(rows.map(chained))
  expect(tampered).toBeUndefined()
  return rows
})

/** Capture stderr writes for the duration of one action. */
const captureStderr = async <A>(run: () => Promise<A>) => {
  const lines: string[] = []
  const original = process.stderr.write.bind(process.stderr)
  const spy = (...args: Parameters<typeof process.stderr.write>) => {
    const [chunk] = args
    lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"))
    return original(...args)
  }
  process.stderr.write = spy as typeof process.stderr.write
  try {
    const result = await run()
    const records = lines
      .flatMap((line) => line.split("\n"))
      .flatMap((line) => {
        if (!line.startsWith("{")) return []
        try {
          return [JSON.parse(line) as Record<string, unknown>]
        } catch {
          return []
        }
      })
    return { result, records }
  } finally {
    process.stderr.write = original
  }
}

test("[SEC-AUDIT-01] login, invitation, and acceptance each produce an attributed Entry", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const { admin, member } = yield* members(app)
      const workspaceID = admin.properties.workspaceID

      const page = yield* Effect.tryPromise(() => app.client["api.audit"].list({ limit: 100 }))

      // Invitation is workspace-visible with the inviting admin as actor.
      const invite = page.data.find((entry) => entry.action === "user.invite")
      expect(invite).toBeDefined()
      expect(invite!.actor).toMatchObject({
        type: "user",
        accountID: admin.properties.accountID,
        userID: admin.properties.userID,
        workspaceID,
      })
      expect(invite!.workspaceID).toBe(workspaceID)
      expect(invite!.detail).toMatchObject({ email: memberEmail, role: "member" })
      expect(new Date(invite!.occurredAt).getTime()).toBeGreaterThan(0)
      expect(invite!.context?.ip).toBeTruthy()
      expect(invite!.chain).toMatch(/^[0-9a-f]{64}$/)

      // Invitation acceptance is workspace-visible with the joining Account as actor.
      const accept = page.data.find((entry) => entry.action === "user.accept")
      expect(accept).toBeDefined()
      expect(accept!.actor).toMatchObject({ type: "account", accountID: member.properties.accountID })
      expect(accept!.workspaceID).toBe(workspaceID)
      expect(accept!.target).toBe(member.properties.userID)

      // Login is installation-scoped: visible through the authority, attributed to the Account.
      const logins = (yield* readAll(app, { actions: ["auth.login"] })).data
      expect(logins.length).toBe(2)
      const login = logins.find(
        (entry) => entry.actor.type === "account" && entry.actor.accountID === member.properties.accountID,
      )
      expect(login).toBeDefined()
      expect(login!.outcome).toBe("success")
      expect(login!.context?.ip).toBeTruthy()

      // The whole stream verifies from genesis.
      yield* verified(app)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-AUDIT-02] a failed login produces a failure Entry with the anonymous principal", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      yield* app.login()

      // Drive the real Local Login flow with a tampered state parameter.
      const cookies = new Map<string, string>()
      const flow = (path: string) =>
        Effect.tryPromise(async () => {
          const response = await fetch(new URL(path, app.origin), {
            redirect: "manual",
            headers: { cookie: [...cookies.values()].join("; ") },
          })
          for (const cookie of response.headers.getSetCookie()) {
            const pair = cookie.split(";")[0]!
            const name = pair.slice(0, pair.indexOf("="))
            if (/max-age=0(?:;|$)/i.test(cookie)) cookies.delete(name)
            else cookies.set(name, pair)
          }
          return response
        })
      const start = yield* flow("/auth/login")
      const location = start.headers.get("location")
      expect(start.status).toBe(302)
      expect(location).toBeTruthy()
      const callback = new URL(location!, app.origin)
      callback.searchParams.set("state", "tampered-state")
      const completed = yield* flow(callback.pathname + callback.search)
      expect(completed.status).toBe(303)
      expect(completed.headers.get("location")).toContain("auth=failed&reason=expired")

      const failures = (yield* readAll(app, { actions: ["auth.login"] })).data.filter(
        (entry) => entry.outcome === "failure",
      )
      expect(failures.length).toBe(1)
      expect(failures[0]!.actor).toMatchObject({ type: "anonymous" })
      expect(failures[0]!.detail).toMatchObject({ reason: "state" })
      expect(failures[0]!.context?.ip).toBeTruthy()
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-AUDIT-03] Service Account and Key lifecycle produce Entries; secrets are never recorded", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const admin = yield* app.login()
      const workspaceID = admin.properties.workspaceID

      const account = yield* Effect.tryPromise(() => app.client.serviceAccount.create({ name: "CI gateway" }))
      const issued = yield* Effect.tryPromise(() =>
        app.client.serviceAccount.key.create({ id: account.id, name: "Production" }),
      )
      yield* Effect.tryPromise(() => app.client.serviceAccount.key.revoke({ id: account.id, keyID: issued.key.id }))
      yield* Effect.tryPromise(() => app.client.serviceAccount.remove({ id: account.id }))

      const page = yield* Effect.tryPromise(() => app.client["api.audit"].list({ limit: 100 }))
      const sequence = ["service-account.create", "key.create", "key.revoke", "service-account.remove"]
      for (const action of sequence) {
        const entry = page.data.find((item) => item.action === action)
        expect(entry, action).toBeDefined()
        expect(entry!.actor).toMatchObject({ type: "user", userID: admin.properties.userID })
        expect(entry!.workspaceID).toBe(workspaceID)
        expect(entry!.outcome).toBe("success")
      }
      expect(page.data.find((item) => item.action === "service-account.create")!.target).toBe(account.id)
      expect(page.data.find((item) => item.action === "key.create")!.target).toBe(issued.key.id)
      expect(page.data.find((item) => item.action === "key.revoke")!.target).toBe(issued.key.id)

      // Redaction rule: the issued Key secret never appears in any recorded detail.
      expect(JSON.stringify(page.data)).not.toContain(issued.secret)

      yield* verified(app)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-AUDIT-04] Config, Permission, and Spend Limit changes produce Entries", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      yield* app.login()

      const current = yield* Effect.tryPromise(() => app.client["api.config"].get())
      yield* Effect.tryPromise(() =>
        app.client["api.config"].update({ ...current, compaction: { ...current.compaction, auto: false } }),
      )
      yield* Effect.tryPromise(() =>
        app.client["api.config"].update({
          ...current,
          permissions: [{ action: "shell", resource: "*", effect: "ask" }],
        }),
      )
      yield* Effect.tryPromise(() => app.client.budget.limit({ target: { type: "workspace" }, amount: 5 }))

      const page = yield* Effect.tryPromise(() => app.client["api.audit"].list({ limit: 100 }))
      const config = page.data.filter((entry) => entry.action === "config.update")
      expect(config.length).toBeGreaterThanOrEqual(2)
      const permission = page.data.find((entry) => entry.action === "permission.write")
      expect(permission).toBeDefined()
      expect(permission!.detail).toMatchObject({ rules: 1 })
      const limit = page.data.find((entry) => entry.action === "budget.limit")
      expect(limit).toBeDefined()
      expect(limit!.detail).toMatchObject({ amount: 5 })

      // Action filter reduces the page to the requested action.
      const filtered = yield* Effect.tryPromise(() =>
        app.client["api.audit"].list({ action: "budget.limit", limit: 100 }),
      )
      expect(filtered.data.length).toBe(1)
      expect(filtered.data[0]!.action).toBe("budget.limit")
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-AUDIT-05] Session deletion produces an Entry", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const data = yield* Chat.make(app)
      yield* Effect.tryPromise(() => app.client.session.delete({ sessionID: data.session.id }))
      const page = yield* Effect.tryPromise(() =>
        app.client["api.audit"].list({ action: "session.delete", limit: 100 }),
      )
      expect(page.data.length).toBe(1)
      expect(page.data[0]!.target).toBe(data.session.id)
      expect(page.data[0]!.actor).toMatchObject({ type: "user", userID: data.owner.properties.userID })
      expect(page.data[0]!.workspaceID).toBe(data.owner.properties.workspaceID)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-AUDIT-06] Share and unshare Tool executions produce Entries", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make({ plugins: ["@bymorning/plugin-share"] })
      const data = yield* Chat.make(app)

      const share = yield* ShareScenario.script(app, data, "share")
      yield* ShareScenario.complete(app, data, share)
      const unshare = yield* ShareScenario.script(app, data, "unshare")
      yield* ShareScenario.complete(app, data, unshare)

      const created = yield* Effect.tryPromise(() =>
        app.client["api.audit"].list({ action: "share.create", limit: 100 }),
      )
      expect(created.data.length).toBe(1)
      expect(created.data[0]!.target).toBe(data.session.id)
      expect(created.data[0]!.actor).toMatchObject({ type: "user", userID: data.owner.properties.userID })
      const revoked = yield* Effect.tryPromise(() =>
        app.client["api.audit"].list({ action: "share.revoke", limit: 100 }),
      )
      expect(revoked.data.length).toBe(1)
      expect(revoked.data[0]!.target).toBe(data.session.id)

      yield* app.llm.settled(data.session.id, "title")
      yield* app.llm.verify()
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-AUDIT-07] members cannot read the Audit; an admin reads only their own Workspace", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const { memberClient } = yield* members(app)
      yield* Effect.tryPromise(() => app.client.serviceAccount.create({ name: "Audited automation" }))

      // A member is refused outright.
      const refused = yield* Effect.tryPromise(() => memberClient["api.audit"].list({ limit: 100 })).pipe(Effect.flip)
      expect(refused.cause ?? refused).toMatchObject({ _tag: "ForbiddenError" })

      // A second Account provisions its own Workspace; its Audit view excludes the first Workspace.
      const outsiderClient = app.clientFor()
      const outsider = yield* app.login(outsiderClient, {
        subject: Auth.Sub.make("test-outsider"),
        email: Auth.Email.make("outsider@bymorning.ai"),
      })
      yield* Effect.tryPromise(() => outsiderClient.serviceAccount.create({ name: "Outsider automation" }))
      const own = yield* Effect.tryPromise(() => outsiderClient["api.audit"].list({ limit: 100 }))
      expect(own.data.length).toBeGreaterThan(0)
      for (const entry of own.data) {
        expect(entry.workspaceID).toBe(outsider.properties.workspaceID)
      }

      // Time-range filters bound the window.
      const future = yield* Effect.tryPromise(() =>
        app.client["api.audit"].list({ from: new Date(Date.now() + 86_400_000), limit: 100 }),
      )
      expect(future.data.length).toBe(0)
      const past = yield* Effect.tryPromise(() =>
        app.client["api.audit"].list({ to: new Date(Date.now() - 86_400_000), limit: 100 }),
      )
      expect(past.data.length).toBe(0)

      // Target filter selects one object.
      const page = yield* Effect.tryPromise(() => app.client["api.audit"].list({ limit: 100 }))
      const create = page.data.find((entry) => entry.action === "service-account.create")!
      const targeted = yield* Effect.tryPromise(() =>
        app.client["api.audit"].list({ target: create.target!, limit: 100 }),
      )
      expect(targeted.data.length).toBeGreaterThan(0)
      for (const entry of targeted.data) expect(entry.target).toBe(create.target)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-AUDIT-08] fail-closed: when the Entry cannot persist the mutation rolls back", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      yield* app.login()

      // Break the append path; the chain column is covered content.
      yield* app.process(
        Database.Service.use((database) =>
          database.use("AuditSpec.break", (db) => db.execute(sql`alter table audit_entry drop column chain`)),
        ),
      )

      const failure = yield* Effect.tryPromise(() =>
        app.client.serviceAccount.create({ name: "Never persisted" }),
      ).pipe(Effect.flip)
      expect(failure.cause ?? failure).toMatchObject({ _tag: "Protocol.InternalError" })

      const accounts = yield* Effect.tryPromise(() => app.client.serviceAccount.list())
      expect(accounts.length).toBe(0)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-AUDIT-09] retention pruning deletes only Entries past the retention window", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      yield* app.login()
      yield* Effect.tryPromise(() => app.client.serviceAccount.create({ name: "Recent" }))

      // One Entry far past the default 365-day retention, appended directly.
      yield* app.process(
        Database.Service.use((database) =>
          database.use("AuditSpec.old", (db) =>
            db.execute(sql`
              insert into audit_entry (id, occurred_at, actor, account_id, action, outcome, chain)
              values (
                'aud_expired_fixture',
                now() - interval '400 days',
                '{"type":"system"}',
                null,
                'setup.complete',
                'success',
                'fixture'
              )
            `),
          ),
        ),
      )
      const before = (yield* readAll(app)).data
      expect(before.some((entry) => entry.id === "aud_expired_fixture")).toBe(true)
      expect(before.some((entry) => entry.action === "service-account.create")).toBe(true)

      const { records } = yield* Effect.tryPromise(() =>
        captureStderr(() => Effect.runPromise(app.process(Audit.Service.use((audit) => audit.prune())), { signal })),
      )
      const after = (yield* readAll(app)).data
      expect(after.some((entry) => entry.id === "aud_expired_fixture")).toBe(false)
      expect(after.some((entry) => entry.action === "service-account.create")).toBe(true)

      // The pruner announces the deletion on stderr before deleting.
      const summaries = records.filter((record) => record["type"] === "audit.prune")
      expect(summaries.length).toBe(1)
      expect(summaries[0]).toMatchObject({ deleted: 1 })
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-AUDIT-10] every committed Entry is emitted as one structured JSON stderr line", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      yield* app.login()

      const { result: account, records } = yield* Effect.tryPromise(() =>
        captureStderr(() => app.client.serviceAccount.create({ name: "Exported" })),
      )
      const lines = records.filter(
        (record) => record["type"] === "audit.entry" && record["action"] === "service-account.create",
      )
      expect(lines.length).toBe(1)
      expect(lines[0]).toMatchObject({
        action: "service-account.create",
        outcome: "success",
        target: account.id,
        actor: { type: "user" },
      })
      expect(lines[0]!["chain"]).toMatch(/^[0-9a-f]{64}$/)
      expect(lines[0]!["id"]).toMatch(/^aud_/)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-AUDIT-11] chain verification detects tampering with stored Entries", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      yield* app.login()
      yield* Effect.tryPromise(() => app.client.serviceAccount.create({ name: "Chain subject" }))
      yield* Effect.tryPromise(() => app.client.budget.limit({ target: { type: "workspace" }, amount: 7 }))

      const intact = yield* verified(app)
      expect(intact.length).toBeGreaterThanOrEqual(3)

      // Rewrite history in place; the digest chain must flag it.
      yield* app.process(
        Database.Service.use((database) =>
          database.use("AuditSpec.tamper", (db) =>
            db.execute(sql`update audit_entry set outcome = 'failure' where action = 'budget.limit'`),
          ),
        ),
      )
      const rows = yield* readRows(app)
      const flagged = Audit.verifyChain(rows.map(chained))
      expect(flagged).toBe(rows.find((row) => row.action === "budget.limit")?.sequence)
    }).pipe(Effect.scoped),
    { signal },
  )
})

/**
 * Establish one real OAuth grant through the public authorization-code flow,
 * signed in as the given client's member: dynamic registration, consent
 * approval, and the PKCE token exchange.
 */
const grantTokens = Effect.fn("AuditSpec.grantTokens")(function* (
  app: TestApp.Interface,
  client: ReturnType<TestApp.Interface["clientFor"]>,
  workspaceID: Workspace.ID,
) {
  return yield* Effect.tryPromise(async () => {
    const redirect = "http://127.0.0.1/callback"
    const registration = await fetch(new URL("/oauth/register", app.origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: [redirect], client_name: "Audit fixture" }),
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
    const approval = await client["api.oauth"].approve({
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
    return { clientID: client_id }
  })
})

test("[SEC-AUDIT-12] logout records auth.logout and the durable Login Session revocation", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const owner = yield* app.login()
      const sessions = yield* Effect.tryPromise(() => app.client.account.session.list())
      expect(sessions.length).toBe(1)

      yield* Effect.tryPromise(() => app.client.auth.logout())

      // The edge records the logout with the session's Account.
      const logouts = (yield* readAll(app, { actions: ["auth.logout"] })).data
      expect(logouts.length).toBe(1)
      expect(logouts[0]!.actor).toMatchObject({ type: "account", accountID: owner.properties.accountID })

      // Auth.end records the durable revocation in the same transaction.
      const revocations = (yield* readAll(app, { actions: ["auth.session.revoke"] })).data
      expect(revocations.length).toBe(1)
      expect(revocations[0]!.actor).toMatchObject({ type: "account", accountID: owner.properties.accountID })
      expect(revocations[0]!.target).toBe(sessions[0]!.id)
      expect(revocations[0]!.detail).toMatchObject({ reason: "logout" })
      yield* verified(app)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-AUDIT-13] Account suspension records its Entry and cascades session and grant revocation; restore records its own", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const { admin, member, memberClient } = yield* members(app)
      const memberSessions = yield* Effect.tryPromise(() => memberClient.account.session.list())
      expect(memberSessions.length).toBe(1)
      yield* grantTokens(app, memberClient, admin.properties.workspaceID)
      const grants = yield* Effect.tryPromise(() => memberClient.account.grant.list())
      expect(grants.length).toBe(1)

      yield* Effect.tryPromise(() => app.client.account.suspend({ accountID: member.properties.accountID }))

      const suspensions = (yield* readAll(app, { actions: ["account.suspend"] })).data
      expect(suspensions.length).toBe(1)
      expect(suspensions[0]!.actor).toMatchObject({ type: "account", accountID: admin.properties.accountID })
      expect(suspensions[0]!.target).toBe(member.properties.accountID)

      // The cascade revoked the member's Login Sessions and OAuth grants, each recorded.
      const revocations = (yield* readAll(app, { actions: ["auth.session.revoke"] })).data.filter(
        (entry) => entry.actor.type === "account" && entry.actor.accountID === member.properties.accountID,
      )
      expect(revocations.map((entry) => entry.target)).toContain(memberSessions[0]!.id)
      const grantRevocations = (yield* readAll(app, { actions: ["oauth.grant.revoke"] })).data
      expect(grantRevocations.length).toBe(1)
      expect(grantRevocations[0]!.target).toBe(grants[0]!.id)
      expect(grantRevocations[0]!.detail).toMatchObject({ reason: "account" })
      expect(grantRevocations[0]!.workspaceID).toBe(admin.properties.workspaceID)

      yield* Effect.tryPromise(() => app.client.account.restore({ accountID: member.properties.accountID }))
      const restorations = (yield* readAll(app, { actions: ["account.restore"] })).data
      expect(restorations.length).toBe(1)
      expect(restorations[0]!.actor).toMatchObject({ type: "account", accountID: admin.properties.accountID })
      expect(restorations[0]!.target).toBe(member.properties.accountID)
      yield* verified(app)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-AUDIT-14] Installation Admin grants, revocations, and Policy updates produce Entries", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const { admin, member } = yield* members(app)

      yield* Effect.tryPromise(() => app.client.installation.admin.grant({ accountID: member.properties.accountID }))
      const grants = (yield* readAll(app, { actions: ["installation.admin.grant"] })).data
      expect(grants.length).toBe(1)
      expect(grants[0]!.actor).toMatchObject({ type: "account", accountID: admin.properties.accountID })
      expect(grants[0]!.target).toBe(member.properties.accountID)

      yield* Effect.tryPromise(() =>
        app.client.installation.policy.update({ share: "off", websearch: "off" }),
      )
      const policies = (yield* readAll(app, { actions: ["installation.policy.update"] })).data
      expect(policies.length).toBe(1)
      expect(policies[0]!.actor).toMatchObject({ type: "account", accountID: admin.properties.accountID })
      expect(policies[0]!.detail).toMatchObject({ policy: { share: "off", websearch: "off" } })

      yield* Effect.tryPromise(() => app.client.installation.admin.revoke({ accountID: member.properties.accountID }))
      const revocations = (yield* readAll(app, { actions: ["installation.admin.revoke"] })).data
      expect(revocations.length).toBe(1)
      expect(revocations[0]!.target).toBe(member.properties.accountID)
      yield* verified(app)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-AUDIT-15] member removal produces an Entry attributed to the removing admin", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const { admin, member } = yield* members(app)
      yield* Effect.tryPromise(() => app.client.user.remove({ userID: member.properties.userID }))

      const removals = (yield* readAll(app, { actions: ["user.remove"] })).data
      expect(removals.length).toBe(1)
      expect(removals[0]!.actor).toMatchObject({
        type: "user",
        accountID: admin.properties.accountID,
        userID: admin.properties.userID,
        workspaceID: admin.properties.workspaceID,
      })
      expect(removals[0]!.workspaceID).toBe(admin.properties.workspaceID)
      expect(removals[0]!.target).toBe(member.properties.userID)
      expect(removals[0]!.detail).toMatchObject({ role: "member" })
      yield* verified(app)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-AUDIT-16] self-service OAuth grant revocation produces an Entry", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const owner = yield* app.login()
      yield* grantTokens(app, app.client, owner.properties.workspaceID)
      const [grant] = yield* Effect.tryPromise(() => app.client.account.grant.list())

      yield* Effect.tryPromise(() => app.client.account.grant.revoke({ grantID: grant!.id }))

      const revocations = (yield* readAll(app, { actions: ["oauth.grant.revoke"] })).data
      expect(revocations.length).toBe(1)
      expect(revocations[0]!.actor).toMatchObject({ type: "account", accountID: owner.properties.accountID })
      expect(revocations[0]!.target).toBe(grant!.id)
      expect(revocations[0]!.workspaceID).toBe(owner.properties.workspaceID)
      yield* verified(app)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-AUDIT-17] the Installation Admin reads Entries across Workspaces; a Workspace admin still reads only their own", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const admin = yield* app.login()
      yield* Effect.tryPromise(() => app.client.serviceAccount.create({ name: "Admin-side automation" }))

      // A second Account provisions its own Workspace; the first login is the Installation Admin.
      const outsiderClient = app.clientFor()
      const outsider = yield* app.login(outsiderClient, {
        subject: Auth.Sub.make("test-outsider"),
        email: Auth.Email.make("outsider@bymorning.ai"),
      })
      yield* Effect.tryPromise(() => outsiderClient.serviceAccount.create({ name: "Outsider automation" }))

      // The Installation Admin reads every Workspace (no selector), or their
      // own selected Workspace; the membership middleware keeps foreign
      // Workspace selection refused even for an Installation Admin.
      const all = yield* Effect.tryPromise(() => app.client["api.audit"].list({ limit: 100 }))
      const workspaces = new Set(all.data.flatMap((entry) => (entry.workspaceID === null ? [] : [entry.workspaceID])))
      expect(workspaces).toContain(admin.properties.workspaceID)
      expect(workspaces).toContain(outsider.properties.workspaceID)
      const selected = yield* Effect.tryPromise(() =>
        app.client["api.audit"].list({ workspace: admin.properties.workspaceID, limit: 100 }),
      )
      expect(selected.data.length).toBeGreaterThan(0)
      for (const entry of selected.data) {
        expect(entry.workspaceID).toBe(admin.properties.workspaceID)
      }

      // The outsider admin reads only their own Workspace.
      const own = yield* Effect.tryPromise(() => outsiderClient["api.audit"].list({ limit: 100 }))
      for (const entry of own.data) {
        expect(entry.workspaceID).toBe(outsider.properties.workspaceID)
      }
    }).pipe(Effect.scoped),
    { signal },
  )
})
