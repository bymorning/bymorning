/**
 * Installation Admin and Installation Policy (NIST 3.1.4/3.1.5 least
 * privilege, 3.3.9 audit management restriction, AC-2 account management):
 * bootstrap assigns the first Installation Admin; Auth Provider and Policy
 * management refuse Workspace administrators without a grant;
 * invite-only provisioning refuses uninvited admitted-domain logins; the
 * Policy lock clamps every Workspace's effective Config; member removal and
 * Account suspension revoke access with last-admin protection. Each test
 * carries a stable [SEC-INST-nn] identifier for compliance reports.
 */
import { Config } from "@bymorning/core/config"
import { Database, ScheduledTaskTable, UserTable } from "@bymorning/core/database"
import { Installation } from "@bymorning/core/installation"
import { Account } from "@bymorning/schema/account"
import { Auth } from "@bymorning/schema/auth"
import { AuthProvider as AuthProviderSchema } from "@bymorning/schema/auth-provider"
import { Provider } from "@bymorning/schema/provider"
import { Effect } from "effect"
import { expect, test } from "vitest"
import { TestApp } from "../../src/application.js"

const memberIdentity = { subject: Auth.Sub.make("test-member"), email: Auth.Email.make("member@bymorning.ai") }

/** Assert the SDK call fails with the expected typed error tag. */
const refused = (tag: string, operation: () => Promise<unknown>) =>
  Effect.gen(function* () {
    const error = yield* Effect.tryPromise(operation).pipe(Effect.flip)
    expect(error.cause ?? error).toMatchObject({ _tag: tag })
  })

const forbidden = (operation: () => Promise<unknown>) => refused("ForbiddenError", operation)
const unauthorized = (operation: () => Promise<unknown>) => refused("UnauthorizedError", operation)

/** Log in the owner and one invited member with an independent cookie jar. */
const members = Effect.fn("SecInst.members")(function* (app: TestApp.Interface, role: "admin" | "member" = "member") {
  const admin = yield* app.login()
  yield* Effect.tryPromise(() => app.client.user.invite({ email: memberIdentity.email, role }))
  const memberClient = app.clientFor()
  const member = yield* app.login(memberClient, memberIdentity)
  return { admin, member, memberClient }
})

test("[SEC-INST-01] the first login after Setup becomes the Installation Admin", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const anonymous = yield* Effect.tryPromise(() => app.client.installation.self()).pipe(Effect.flip)
      expect(anonymous.cause).toMatchObject({ _tag: "UnauthorizedError" })

      const owner = yield* app.login()
      expect(yield* Effect.tryPromise(() => app.client.installation.self())).toEqual({ admin: true })
      const admins = yield* Effect.tryPromise(() => app.client.installation.admin.list())
      expect(admins.admins).toEqual([owner.properties.accountID])
      expect(yield* app.process(Installation.Service.use((service) => service.check(owner.properties.accountID)))).toBe(
        true,
      )

      // A later invited member holds no Installation Admin grant.
      yield* Effect.tryPromise(() => app.client.user.invite({ email: memberIdentity.email, role: "member" }))
      const memberClient = app.clientFor()
      yield* app.login(memberClient, memberIdentity)
      expect(yield* Effect.tryPromise(() => memberClient.installation.self())).toEqual({ admin: false })
      yield* forbidden(() => memberClient.installation.admin.list())
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-INST-02] a Workspace administrator without a grant cannot manage Auth Providers or the Policy", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const { member, memberClient } = yield* members(app, "admin")

      // The member is a Workspace admin but holds no Installation Admin grant.
      expect(yield* Effect.tryPromise(() => memberClient.installation.self())).toEqual({ admin: false })
      yield* forbidden(() =>
        memberClient["api.auth-provider"].authProvider.create({
          id: AuthProviderSchema.ID.create(),
          displayName: "Rogue IdP",
          kind: "custom",
          issuer: "https://idp.example.com",
          clientID: "client",
          clientSecret: "secret",
          domains: ["example.com"],
        }),
      )
      yield* forbidden(() => memberClient.installation.policy.get())
      yield* forbidden(() => memberClient.installation.policy.update({ provisioning: "open" }))
      yield* forbidden(() => memberClient.installation.admin.grant({ accountID: member.properties.accountID }))

      // The Installation Admin reaches the same endpoints.
      expect((yield* Effect.tryPromise(() => app.client.installation.policy.get())).provisioning).toBe("open")
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-INST-03] invite-only provisioning refuses an uninvited admitted-domain first login", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make({ provisioning: "invite-only" })
      const owner = yield* app.login()
      expect((yield* Effect.tryPromise(() => app.client.installation.policy.get())).provisioning).toBeUndefined()

      // The bootstrap login succeeds; an uninvited admitted-domain login is refused.
      const uninvited = app.clientFor()
      const rejection = yield* app.login(uninvited, memberIdentity).pipe(Effect.flip)
      expect(rejection).toMatchObject({ _tag: "TestApp.RequestError" })
      expect((yield* Effect.tryPromise(() => app.client.user.list())).members).toHaveLength(1)

      // An invitation admits the same login.
      yield* Effect.tryPromise(() => app.client.user.invite({ email: memberIdentity.email, role: "member" }))
      const invited = app.clientFor()
      const member = yield* app.login(invited, memberIdentity)
      expect(member.properties.role).toBe("member")
      expect(member.properties.workspaceID).toBe(owner.properties.workspaceID)
      expect((yield* Effect.tryPromise(() => app.client.user.list())).members).toHaveLength(2)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-INST-04] the Policy lock clamps providers.allow and disables share and web search", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      yield* app.process(
        Installation.Service.use((service) =>
          service.policy.update({
            provisioning: "open",
            providers: { allow: [Provider.Fireworks] },
            share: "off",
            websearch: "off",
          }),
        ),
      )
      const owner = yield* app.login()
      const sharePlugin = "@bymorning/plugin-share"
      yield* app.workspace(
        { account: { type: "account", properties: { accountID: owner.properties.accountID } } },
        Config.Service.use((config) =>
          Effect.gen(function* () {
            const current = yield* config.get
            yield* config.update(
              {
                ...current,
                providers: { allow: [Provider.OpenAI] },
                plugins: [...(current.plugins ?? []), sharePlugin],
                websearch: { provider: "random" },
              },
              owner,
            )
          }),
        ),
      )
      const effective = yield* app.workspace(
        { account: { type: "account", properties: { accountID: owner.properties.accountID } } },
        Config.Service.use((config) => config.get),
      )
      // The Workspace allowlist cannot exceed the Installation allowlist.
      expect(effective.providers?.allow).toEqual([])
      // The share Plugin is removed, disabling the share Tool installation-wide.
      const pluginNames = (effective.plugins ?? []).map((entry) => (typeof entry === "string" ? entry : entry.package))
      expect(pluginNames).not.toContain(sharePlugin)
      // The model fixture Plugin survives: the lock disables share, not Plugins.
      expect((effective.plugins ?? []).length).toBeGreaterThan(0)
      expect(effective.websearch).toBe(false)

      // A Workspace without its own restriction inherits the Installation allowlist.
      yield* app.workspace(
        { account: { type: "account", properties: { accountID: owner.properties.accountID } } },
        Config.Service.use((config) =>
          Effect.gen(function* () {
            const current = yield* config.get
            const { providers: _, ...rest } = current
            yield* config.update(rest, owner)
          }),
        ),
      )
      const inherited = yield* app.workspace(
        { account: { type: "account", properties: { accountID: owner.properties.accountID } } },
        Config.Service.use((config) => config.get),
      )
      expect(inherited.providers?.allow).toEqual([Provider.Fireworks])
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-INST-05] last-admin protection applies to member removal and Installation Admin revoke", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const { admin, member, memberClient } = yield* members(app)

      // The sole Workspace admin cannot be removed.
      const lastAdmin = yield* Effect.tryPromise(() =>
        app.client.user.remove({ userID: admin.properties.userID }),
      ).pipe(Effect.flip)
      expect(lastAdmin.cause).toMatchObject({ _tag: "Protocol.InputError" })

      // The sole Installation Admin cannot be revoked.
      const lastInstallationAdmin = yield* Effect.tryPromise(() =>
        app.client.installation.admin.revoke({ accountID: admin.properties.accountID }),
      ).pipe(Effect.flip)
      expect(lastInstallationAdmin.cause).toMatchObject({ _tag: "Protocol.InputError" })

      // A second Installation Admin unlocks revocation of the first; the grant
      // is account-scoped and does not depend on the member's Workspace Role.
      const granted = yield* Effect.tryPromise(() =>
        app.client.installation.admin.grant({ accountID: member.properties.accountID }),
      )
      expect(granted.admins).toEqual([admin.properties.accountID, member.properties.accountID])
      expect(yield* Effect.tryPromise(() => memberClient.installation.self())).toEqual({ admin: true })
      const revoked = yield* Effect.tryPromise(() =>
        memberClient.installation.admin.revoke({ accountID: admin.properties.accountID }),
      )
      expect(revoked.admins).toEqual([member.properties.accountID])
      expect(yield* Effect.tryPromise(() => app.client.installation.self())).toEqual({ admin: false })
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-INST-06] a removed member loses access immediately and the membership is retained as a record", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const { member, memberClient } = yield* members(app)
      expect((yield* Effect.tryPromise(() => memberClient.user.list())).members).toHaveLength(2)

      yield* Effect.tryPromise(() => app.client.user.remove({ userID: member.properties.userID }))
      yield* unauthorized(() => memberClient.user.list())
      expect((yield* Effect.tryPromise(() => app.client.user.list())).members).toHaveLength(1)

      // Removal is a soft delete: the membership row and its attribution remain.
      const rows = yield* app.process(
        Database.Service.use((database) =>
          database.use("SecInst.removed", (db) =>
            db.select({ id: UserTable.id, timeDeleted: UserTable.timeDeleted }).from(UserTable),
          ),
        ),
      )
      expect(rows.find((row) => row.id === member.properties.userID)?.timeDeleted).toBeInstanceOf(Date)

      // Re-inviting the same Account revives a working membership.
      yield* Effect.tryPromise(() => app.client.user.invite({ email: memberIdentity.email, role: "member" }))
      const reinvited = app.clientFor()
      yield* app.login(reinvited, memberIdentity)
      expect((yield* Effect.tryPromise(() => reinvited.user.list())).members).toHaveLength(2)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-INST-07] a suspended Account is refused on its next request and its Scheduled Tasks pause", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const { member, memberClient } = yield* members(app)
      const project = yield* Effect.tryPromise(() =>
        memberClient.project.create({ workspace: member.properties.workspaceID, name: "Member project" }),
      )
      const task = yield* Effect.tryPromise(() =>
        memberClient.scheduledTask.create({
          name: "Member briefing",
          prompt: "Summarize repository activity.",
          cron: "0 9 * * 1-5",
          timezone: "America/New_York",
          projectID: project.id,
        }),
      )
      expect(task.enabled).toBe(true)

      // Only an Installation Admin may suspend; the member cannot suspend anyone.
      yield* forbidden(() => memberClient.account.suspend({ accountID: member.properties.accountID }))

      yield* Effect.tryPromise(() => app.client.account.suspend({ accountID: member.properties.accountID }))
      // The existing cookie is refused on the next request.
      yield* unauthorized(() => memberClient.user.list())
      yield* unauthorized(() => memberClient.account.get())

      const tasks = yield* app.process(
        Database.Service.use((database) =>
          database.use("SecInst.tasks", (db) =>
            db.select({ id: ScheduledTaskTable.id, enabled: ScheduledTaskTable.enabled }).from(ScheduledTaskTable),
          ),
        ),
      )
      expect(tasks.find((row) => row.id === task.id)?.enabled).toBe(false)

      // Restore re-enables login; the membership was never touched. The
      // revoked Login Session stays revoked, so the member signs in again.
      yield* Effect.tryPromise(() => app.client.account.restore({ accountID: member.properties.accountID }))
      yield* unauthorized(() => memberClient.user.list())
      yield* app.login(memberClient, memberIdentity)
      expect((yield* Effect.tryPromise(() => memberClient.user.list())).members).toHaveLength(2)
      // Suspending an unknown Account is refused as not found.
      const missing = yield* Effect.tryPromise(() =>
        app.client.account.suspend({ accountID: Account.ID.make("acc_0000000000000000000000000f") }),
      ).pipe(Effect.flip)
      expect(missing.cause).toMatchObject({ _tag: "Protocol.InputError" })
    }).pipe(Effect.scoped),
    { signal },
  )
})
