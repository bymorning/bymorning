import { Auth } from "@bymorning/core/auth"
import { Database } from "@bymorning/core/database"
import { Installation } from "@bymorning/core/installation"
import { Storage } from "@bymorning/core/storage"
import * as AuthSchema from "@bymorning/schema/auth"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { and, eq, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { beforeAll, expect, test } from "vitest"
import { AccountTable } from "../../src/database/schema/account.sql.js"
import { AgentTable } from "../../src/database/schema/agent.sql.js"
import { ConfigTable } from "../../src/database/schema/config.sql.js"
import { AuthTable } from "../../src/database/schema/auth.sql.js"
import { ProjectTable } from "../../src/database/schema/project.sql.js"
import { UserTable } from "../../src/database/schema/user.sql.js"
import { WorkspaceTable } from "../../src/database/schema/workspace.sql.js"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { compile } from "./graph.js"

if (process.env.DATABASE_URL === undefined) throw new Error("DATABASE_URL is required for Core integration tests")

const layer = compile(
  LayerNode.group([
    Auth.makeNode({ database: Database.node, storage: Storage.node }, ["bymorning.ai"]),
    Installation.node,
    Database.node,
  ]),
)

// The product default is invite-only provisioning. These scenarios exercise
// first-login provisioning itself, so open the Installation like a host that
// admits its configured email domains without invitations.
beforeAll(() =>
  Effect.runPromise(
    Installation.Service.use((installation) => installation.policy.update({ provisioning: "open" })).pipe(
      Effect.provide(layer),
    ),
  ),
)
const assertion = (provider: string, subject: string, email: string): AuthSchema.Assertion => ({
  provider: AuthSchema.Provider.make(provider),
  subject: AuthSchema.Sub.make(subject),
  verifiedEmail: Schema.decodeUnknownSync(AuthSchema.Email)(email),
})

const removeAccount = (accountID: typeof AccountTable.$inferSelect.id) =>
  Database.Service.use((database) =>
    database.use("AuthTest.removeAccount", (db) =>
      Effect.gen(function* () {
        const workspaceIDs = (yield* db
          .select({ id: UserTable.workspaceId })
          .from(UserTable)
          .where(eq(UserTable.accountId, accountID))).map(({ id }) => id)
        for (const workspaceID of workspaceIDs) {
          yield* db.delete(ProjectTable).where(eq(ProjectTable.workspaceID, workspaceID))
          yield* db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID))
        }
        yield* db.delete(AccountTable).where(eq(AccountTable.id, accountID))
      }),
    ),
  ).pipe(Effect.orDie)

test("admits the exact email domain after canonical case and whitespace normalization", async () => {
  const inputs = [
    assertion("test-domain-exact", AuthSchema.ID.create(), `${AuthSchema.ID.create()}@bymorning.ai`),
    assertion("test-domain-normalized", AuthSchema.ID.create(), `  ${AuthSchema.ID.create()}@ByMorning.AI  `),
  ]
  const accountIDs: Array<typeof AccountTable.$inferSelect.id> = []
  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      expect(inputs[1]?.verifiedEmail.endsWith("@bymorning.ai")).toBe(true)
      for (const input of inputs) {
        accountIDs.push((yield* auth.resolve(input)).properties.accountID)
      }
    }).pipe(Effect.ensuring(Effect.forEach(accountIDs, removeAccount, { discard: true })), Effect.provide(layer)),
  )
})

test("rejects non-exact email domains before first-login persistence", async () => {
  const inputs = [
    assertion("test-domain-subdomain", AuthSchema.ID.create(), "person@sub.bymorning.ai"),
    assertion("test-domain-suffix", AuthSchema.ID.create(), "person@bymorning.ai.evil.test"),
    assertion("test-domain-dot", AuthSchema.ID.create(), "person@bymorning.ai."),
    assertion("test-domain-unicode", AuthSchema.ID.create(), "person@bymorníng.ai"),
    assertion("test-domain-full-width", AuthSchema.ID.create(), "person@ｂｙｍｏｒｎｉｎｇ．ａｉ"),
  ]
  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const database = yield* Database.Service
      yield* database.use("AuthTest.rejectDomain", (db) =>
        Effect.gen(function* () {
          const before = {
            accounts: yield* db.select({ id: AccountTable.id }).from(AccountTable),
            auth: yield* db.select({ id: AuthTable.id }).from(AuthTable),
            workspaces: yield* db.select({ id: WorkspaceTable.id }).from(WorkspaceTable),
            users: yield* db.select({ id: UserTable.id }).from(UserTable),
            agents: yield* db.select({ name: AgentTable.name }).from(AgentTable),
          }
          for (const input of inputs) {
            const error = yield* auth.resolve(input).pipe(Effect.flip)
            expect(error).toEqual(new Auth.RejectedError({ reason: "email-domain" }))
            expect(JSON.stringify(error)).not.toContain(input.verifiedEmail)
          }
          expect(yield* db.select({ id: AccountTable.id }).from(AccountTable)).toEqual(before.accounts)
          expect(yield* db.select({ id: AuthTable.id }).from(AuthTable)).toEqual(before.auth)
          expect(yield* db.select({ id: WorkspaceTable.id }).from(WorkspaceTable)).toEqual(before.workspaces)
          expect(yield* db.select({ id: UserTable.id }).from(UserTable)).toEqual(before.users)
          expect(yield* db.select({ name: AgentTable.name }).from(AgentTable)).toEqual(before.agents)
        }),
      )
    }).pipe(Effect.provide(layer)),
  )
})

test("rejects a disallowed assertion for an existing provider link without mutation", async () => {
  const input = assertion("test-existing-domain", AuthSchema.ID.create(), `${AuthSchema.ID.create()}@bymorning.ai`)
  let accountID: typeof AccountTable.$inferSelect.id | undefined
  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const database = yield* Database.Service
      yield* database.use("AuthTest.existingLink", (db) =>
        Effect.gen(function* () {
          accountID = (yield* auth.resolve(input)).properties.accountID
          const before = {
            account: yield* db.select().from(AccountTable).where(eq(AccountTable.id, accountID)),
            auth: yield* db.select().from(AuthTable).where(eq(AuthTable.accountId, accountID)),
            users: yield* db.select().from(UserTable).where(eq(UserTable.accountId, accountID)),
          }
          const error = yield* auth
            .resolve({
              provider: input.provider,
              subject: input.subject,
              verifiedEmail: AuthSchema.Email.make("person@other.test"),
            })
            .pipe(Effect.flip)
          expect(error).toEqual(new Auth.RejectedError({ reason: "email-domain" }))
          expect(yield* db.select().from(AccountTable).where(eq(AccountTable.id, accountID))).toEqual(before.account)
          expect(yield* db.select().from(AuthTable).where(eq(AuthTable.accountId, accountID))).toEqual(before.auth)
          expect(yield* db.select().from(UserTable).where(eq(UserTable.accountId, accountID))).toEqual(before.users)
        }),
      )
    }).pipe(
      Effect.ensuring(Effect.suspend(() => (accountID === undefined ? Effect.void : removeAccount(accountID)))),
      Effect.provide(layer),
    ),
  )
})

test("concurrent first resolution creates one complete provisioned Account", async () => {
  const input = assertion("test-concurrent", AuthSchema.ID.create(), `${AuthSchema.ID.create()}@bymorning.ai`)
  let accountID: typeof AccountTable.$inferSelect.id | undefined
  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const database = yield* Database.Service
      yield* database.use("AuthTest.concurrent", (db) =>
        Effect.gen(function* () {
          const actors = yield* Effect.all([auth.resolve(input), auth.resolve(input)], { concurrency: "unbounded" })
          accountID = actors[0].properties.accountID
          expect(actors[1]).toEqual(actors[0])

          const logicalLinks = yield* db
            .select({ accountID: AuthTable.accountId })
            .from(AuthTable)
            .where(and(eq(AuthTable.provider, input.provider), eq(AuthTable.subject, input.subject)))
          expect(logicalLinks).toEqual([{ accountID }])

          const users = yield* db.select().from(UserTable).where(eq(UserTable.accountId, accountID))
          expect(users).toHaveLength(1)
          expect(users[0]?.role).toBe("admin")
          const workspaceID = users[0]?.workspaceId
          expect(workspaceID).toBeDefined()
          if (workspaceID === undefined) return
          expect(yield* db.select().from(AgentTable).where(eq(AgentTable.workspaceId, workspaceID))).toHaveLength(0)
          expect(yield* db.select().from(ConfigTable).where(eq(ConfigTable.workspaceId, workspaceID))).toEqual([
            expect.objectContaining({ workspaceId: workspaceID, value: {} }),
          ])
          expect(yield* db.select().from(AuthTable).where(eq(AuthTable.accountId, accountID))).toHaveLength(1)

          const second = yield* auth.resolve(assertion("test-second", AuthSchema.ID.create(), input.verifiedEmail))
          expect(second.properties.accountID).not.toBe(accountID)
        }),
      )
    }).pipe(
      Effect.ensuring(Effect.suspend(() => (accountID === undefined ? Effect.void : removeAccount(accountID)))),
      Effect.provide(layer),
    ),
  )
})

test("claims pending invitations before provisioning and skips the default Workspace", async () => {
  const input = assertion("test-invited", AuthSchema.ID.create(), `${AuthSchema.ID.create()}@bymorning.ai`)
  const workspaceID = Workspace.ID.create()
  const userID = User.ID.create()
  let accountID: typeof AccountTable.$inferSelect.id | undefined
  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const database = yield* Database.Service
      yield* database.use("AuthTest.invitedSetup", (db) =>
        Effect.gen(function* () {
          yield* db.insert(WorkspaceTable).values({ id: workspaceID, name: "Invited", status: "active" })
          yield* db.insert(UserTable).values({
            id: userID,
            workspaceId: workspaceID,
            accountId: null,
            email: input.verifiedEmail,
            role: "admin",
          })
        }),
      )

      const resolvedAccountID = (yield* auth.resolve(input)).properties.accountID
      accountID = resolvedAccountID
      expect(
        yield* database.use("AuthTest.claimed", (db) => db.select().from(UserTable).where(eq(UserTable.id, userID))),
      ).toEqual([expect.objectContaining({ accountId: accountID, email: null, role: "admin", timeDeleted: null })])
      expect(
        yield* database.use("AuthTest.noDefault", (db) =>
          db.select({ id: UserTable.id }).from(UserTable).where(eq(UserTable.accountId, resolvedAccountID)),
        ),
      ).toEqual([{ id: userID }])
    }).pipe(
      Effect.ensuring(
        Effect.suspend(() =>
          accountID === undefined
            ? Database.Service.use((database) =>
                database.use("AuthTest.invitedCleanup", (db) =>
                  db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID)),
                ),
              ).pipe(Effect.orDie)
            : removeAccount(accountID),
        ),
      ),
      Effect.provide(layer),
    ),
  )
})

test("claims every invitation but only usable memberships suppress the default Workspace", async () => {
  const input = assertion("test-unusable-invited", AuthSchema.ID.create(), `${AuthSchema.ID.create()}@bymorning.ai`)
  const deletedWorkspaceID = Workspace.ID.create()
  const unavailableWorkspaceID = Workspace.ID.create()
  const deletedUserID = User.ID.create()
  const unavailableUserID = User.ID.create()
  const deletedAt = new Date()
  let accountID: typeof AccountTable.$inferSelect.id | undefined
  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const database = yield* Database.Service
      yield* database.use("AuthTest.unusableInvitedSetup", (db) =>
        Effect.gen(function* () {
          yield* db.insert(WorkspaceTable).values([
            { id: deletedWorkspaceID, name: "Deleted invitation", status: "active" },
            { id: unavailableWorkspaceID, name: "Unavailable invitation", status: "suspended" },
          ])
          yield* db.insert(UserTable).values([
            {
              id: deletedUserID,
              workspaceId: deletedWorkspaceID,
              email: input.verifiedEmail,
              role: "admin",
              timeDeleted: deletedAt,
            },
            {
              id: unavailableUserID,
              workspaceId: unavailableWorkspaceID,
              email: input.verifiedEmail,
              role: "member",
            },
          ])
        }),
      )

      const resolvedAccountID = (yield* auth.resolve(input)).properties.accountID
      accountID = resolvedAccountID
      const memberships = yield* database.use("AuthTest.unusableInvitedClaimed", (db) =>
        db.select().from(UserTable).where(eq(UserTable.accountId, resolvedAccountID)),
      )
      expect(memberships).toHaveLength(3)
      expect(memberships.find(({ id }) => id === deletedUserID)).toMatchObject({
        accountId: resolvedAccountID,
        email: null,
        timeDeleted: deletedAt,
      })
      expect(memberships.find(({ id }) => id === unavailableUserID)).toMatchObject({
        accountId: resolvedAccountID,
        email: null,
        timeDeleted: null,
      })
      expect(memberships).toContainEqual(expect.objectContaining({ role: "admin", timeDeleted: null }))
    }).pipe(
      Effect.ensuring(Effect.suspend(() => (accountID === undefined ? Effect.void : removeAccount(accountID)))),
      Effect.provide(layer),
    ),
  )
})

test("restores links, rejects unavailable Accounts, and does not expose identity values", async () => {
  const input = assertion("test-restore", AuthSchema.ID.create(), `${AuthSchema.ID.create()}@bymorning.ai`)
  let accountID: typeof AccountTable.$inferSelect.id | undefined
  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const database = yield* Database.Service
      yield* database.use("AuthTest.restore", (db) =>
        Effect.gen(function* () {
          accountID = (yield* auth.resolve(input)).properties.accountID
          expect(yield* db.select().from(AuthTable).where(eq(AuthTable.accountId, accountID))).toHaveLength(1)
          yield* db.update(AuthTable).set({ timeDeleted: new Date() }).where(eq(AuthTable.accountId, accountID))
          yield* auth.resolve(input)
          expect(
            (yield* db.select().from(AuthTable).where(eq(AuthTable.accountId, accountID))).every(
              ({ timeDeleted }) => timeDeleted === null,
            ),
          ).toBe(true)
          yield* db.update(AccountTable).set({ status: "suspended" }).where(eq(AccountTable.id, accountID))
          const error = yield* auth.resolve(input).pipe(Effect.flip)
          expect(error).toEqual(new Auth.RejectedError({ reason: "account-unavailable" }))
          expect(JSON.stringify(error)).not.toContain(input.subject)
          expect(JSON.stringify(error)).not.toContain(input.verifiedEmail)
        }),
      )
    }).pipe(
      Effect.ensuring(Effect.suspend(() => (accountID === undefined ? Effect.void : removeAccount(accountID)))),
      Effect.provide(layer),
    ),
  )
})

test("same provider and sub keep one Account when email changes", async () => {
  const first = assertion("test-split", AuthSchema.ID.create(), `${AuthSchema.ID.create()}@bymorning.ai`)
  const second = assertion("test-other", AuthSchema.ID.create(), `${AuthSchema.ID.create()}@bymorning.ai`)
  const accountIDs: Array<typeof AccountTable.$inferSelect.id> = []
  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const firstID = (yield* auth.resolve(first)).properties.accountID
      const secondID = (yield* auth.resolve(second)).properties.accountID
      accountIDs.push(firstID, secondID)
      expect(secondID).not.toBe(firstID)
      const again = yield* auth.resolve({
        provider: first.provider,
        subject: first.subject,
        verifiedEmail: second.verifiedEmail,
      })
      expect(again.properties.accountID).toBe(firstID)
    }).pipe(Effect.ensuring(Effect.forEach(accountIDs, removeAccount, { discard: true })), Effect.provide(layer)),
  )
})

test("rolls back first-Account creation when Workspace defaults cannot be provisioned", async () => {
  const input = assertion("test-rollback", AuthSchema.ID.create(), `${AuthSchema.ID.create()}@bymorning.ai`)
  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const database = yield* Database.Service
      yield* database.use("AuthTest.rollback", (db) =>
        Effect.gen(function* () {
          const before = {
            accounts: yield* db.select({ id: AccountTable.id }).from(AccountTable),
            auth: yield* db.select({ id: AuthTable.id }).from(AuthTable),
            workspaces: yield* db.select({ id: WorkspaceTable.id }).from(WorkspaceTable),
            users: yield* db.select({ id: UserTable.id }).from(UserTable),
            agents: yield* db.select({ id: AgentTable.name, workspaceID: AgentTable.workspaceId }).from(AgentTable),
          }
          yield* db.execute(
            sql.raw(`
        create function bm_test_reject_config() returns trigger language plpgsql as $$
        begin raise exception 'intentional default failure'; end $$;
        create trigger bm_test_reject_config before insert on workspace_config
        for each row execute function bm_test_reject_config();
      `),
          )
          const error = yield* auth.resolve(input).pipe(Effect.flip)
          expect(error).toEqual(new Auth.ProvisionError({}))
          expect(yield* db.select({ id: AccountTable.id }).from(AccountTable)).toEqual(before.accounts)
          expect(yield* db.select({ id: AuthTable.id }).from(AuthTable)).toEqual(before.auth)
          expect(yield* db.select({ id: WorkspaceTable.id }).from(WorkspaceTable)).toEqual(before.workspaces)
          expect(yield* db.select({ id: UserTable.id }).from(UserTable)).toEqual(before.users)
          expect(
            yield* db.select({ id: AgentTable.name, workspaceID: AgentTable.workspaceId }).from(AgentTable),
          ).toEqual(before.agents)
        }),
      )
    }).pipe(
      Effect.ensuring(
        Database.Service.use((database) =>
          database.use("AuthTest.cleanupTrigger", (db) =>
            db.execute(
              sql.raw(`
              drop trigger if exists bm_test_reject_config on workspace_config;
              drop function if exists bm_test_reject_config();
            `),
            ),
          ),
        ).pipe(Effect.orDie),
      ),
      Effect.provide(layer),
    ),
  )
})
