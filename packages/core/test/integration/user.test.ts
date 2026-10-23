import { describe, expect, it } from "vitest"
import { Database } from "@bymorning/core/database"
import { User } from "@bymorning/core/user"
import { Account } from "@bymorning/schema/account"
import { AccountActor, UserActor } from "@bymorning/schema/actor"
import { Auth } from "@bymorning/schema/auth"
import * as UserSchema from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { eq, sql } from "drizzle-orm"
import { Effect } from "effect"
import { AccountTable } from "../../src/database/schema/account.sql.js"
import { AuthTable } from "../../src/database/schema/auth.sql.js"
import { UserTable } from "../../src/database/schema/user.sql.js"
import { WorkspaceTable } from "../../src/database/schema/workspace.sql.js"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { compile } from "./graph.js"

if (process.env.DATABASE_URL === undefined) throw new Error("DATABASE_URL is required for Core integration tests")

const testLayer = compile(LayerNode.group([User.node, Database.node]))

describe("User.select", () => {
  it("selects an exact membership or the stable oldest usable default without provisioning", async () => {
    const accountID = Account.ID.create()
    const memberAccountID = Account.ID.create()
    const olderWorkspaceID = Workspace.ID.create()
    const newerWorkspaceID = Workspace.ID.create()
    const olderUserID = UserSchema.ID.create()
    const newerUserID = UserSchema.ID.create()
    const memberUserID = UserSchema.ID.create()

    await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database.Service
        const users = yield* User.Service
        yield* database.use("UserTest.setup", (db) =>
          Effect.gen(function* () {
            yield* db.insert(AccountTable).values([
              { id: accountID, status: "active" },
              { id: memberAccountID, status: "active" },
            ])
            yield* db.insert(AuthTable).values([
              {
                id: Auth.ID.create(),
                provider: Auth.Provider.make("email"),
                subject: Auth.Sub.make("owner@bymorning.ai"),
                accountId: accountID,
              },
              {
                id: Auth.ID.create(),
                provider: Auth.Provider.make("email"),
                subject: Auth.Sub.make("member@bymorning.ai"),
                accountId: memberAccountID,
              },
            ])
            yield* db.insert(WorkspaceTable).values([
              { id: olderWorkspaceID, name: "Older", status: "active" },
              { id: newerWorkspaceID, name: "Newer", status: "active" },
            ])
            yield* db.insert(UserTable).values([
              { id: olderUserID, accountId: accountID, workspaceId: olderWorkspaceID, role: "member" },
              { id: newerUserID, accountId: accountID, workspaceId: newerWorkspaceID, role: "admin" },
              { id: memberUserID, accountId: memberAccountID, workspaceId: olderWorkspaceID, role: "member" },
            ])
            yield* db.execute(sql`update "user" set time_created = now() - interval '1 day' where id = ${olderUserID}`)
          }),
        )
        const account = new AccountActor({ type: "account", properties: { accountID } })

        expect(yield* users.select({ account })).toMatchObject({
          properties: { userID: olderUserID, workspaceID: olderWorkspaceID, role: "member" },
        })
        expect(yield* users.select({ account, workspaceID: newerWorkspaceID })).toMatchObject({
          properties: { userID: newerUserID, workspaceID: newerWorkspaceID, role: "admin" },
        })
        expect(
          yield* users.list(
            new UserActor({
              type: "user",
              properties: { accountID, userID: olderUserID, workspaceID: olderWorkspaceID, role: "member" },
            }),
          ),
        ).toEqual({
          role: "member",
          members: [
            { id: olderUserID, accountID, email: "owner@bymorning.ai", role: "member", status: "active" },
            {
              id: memberUserID,
              accountID: memberAccountID,
              email: "member@bymorning.ai",
              role: "member",
              status: "active",
            },
          ],
        })
        expect(
          yield* users.list(
            new UserActor({
              type: "user",
              properties: { accountID, userID: newerUserID, workspaceID: newerWorkspaceID, role: "admin" },
            }),
          ),
        ).toEqual({
          role: "admin",
          members: [{ id: newerUserID, accountID, email: "owner@bymorning.ai", role: "admin", status: "active" }],
        })
        expect(
          yield* database.use("UserTest.verify", (db) =>
            db.select().from(UserTable).where(eq(UserTable.accountId, accountID)),
          ),
        ).toHaveLength(2)
      }).pipe(
        Effect.ensuring(
          Database.Service.use((database) =>
            database.use("UserTest.cleanup", (db) =>
              Effect.gen(function* () {
                yield* db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, olderWorkspaceID))
                yield* db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, newerWorkspaceID))
                yield* db.delete(AccountTable).where(eq(AccountTable.id, accountID))
                yield* db.delete(AccountTable).where(eq(AccountTable.id, memberAccountID))
              }),
            ),
          ).pipe(Effect.orDie),
        ),
        Effect.provide(testLayer),
      ),
    )
  })

  it("rejects unavailable and foreign records without falling back", async () => {
    const accountID = Account.ID.create()
    const workspaceID = Workspace.ID.create()
    const foreignWorkspaceID = Workspace.ID.create()
    const userID = UserSchema.ID.create()

    await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database.Service
        const users = yield* User.Service
        yield* database.use("UserTest.setup", (db) =>
          Effect.gen(function* () {
            yield* db.insert(AccountTable).values({ id: accountID, status: "active" })
            yield* db.insert(WorkspaceTable).values([
              { id: workspaceID, name: "Available", status: "active" },
              { id: foreignWorkspaceID, name: "Foreign", status: "active" },
            ])
            yield* db.insert(UserTable).values({
              id: userID,
              accountId: accountID,
              workspaceId: workspaceID,
              role: "admin",
            })
          }),
        )
        const account = new AccountActor({ type: "account", properties: { accountID } })

        expect(yield* users.select({ account, workspaceID: foreignWorkspaceID }).pipe(Effect.flip)).toEqual(
          new User.AccessError({ reason: "workspace-unavailable" }),
        )
        yield* database.use("UserTest.suspend", (db) =>
          db.update(WorkspaceTable).set({ status: "suspended" }).where(eq(WorkspaceTable.id, workspaceID)),
        )
        expect(yield* users.select({ account }).pipe(Effect.flip)).toEqual(
          new User.AccessError({ reason: "membership-unavailable" }),
        )
        yield* database.use("UserTest.delete", (db) =>
          Effect.gen(function* () {
            yield* db.update(WorkspaceTable).set({ status: "active" }).where(eq(WorkspaceTable.id, workspaceID))
            yield* db.update(AccountTable).set({ timeDeleted: new Date() }).where(eq(AccountTable.id, accountID))
          }),
        )
        expect(yield* users.select({ account }).pipe(Effect.flip)).toEqual(
          new User.AccessError({ reason: "membership-unavailable" }),
        )
      }).pipe(
        Effect.ensuring(
          Database.Service.use((database) =>
            database.use("UserTest.cleanup", (db) =>
              Effect.gen(function* () {
                yield* db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID))
                yield* db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, foreignWorkspaceID))
                yield* db.delete(AccountTable).where(eq(AccountTable.id, accountID))
              }),
            ),
          ).pipe(Effect.orDie),
        ),
        Effect.provide(testLayer),
      ),
    )
  })
})

describe("User.invite", () => {
  it("upserts invitations and admits known Accounts using explicit Workspace input", async () => {
    const ownerAccountID = Account.ID.create()
    const knownAccountID = Account.ID.create()
    const workspaceID = Workspace.ID.create()
    const ownerUserID = UserSchema.ID.create()
    const knownUserID = UserSchema.ID.create()
    const owner = new UserActor({
      type: "user",
      properties: { accountID: ownerAccountID, userID: ownerUserID, workspaceID, role: "admin" },
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database.Service
        const users = yield* User.Service
        yield* database.use("UserInviteTest.setup", (db) =>
          Effect.gen(function* () {
            yield* db.insert(AccountTable).values([
              { id: ownerAccountID, status: "active" },
              { id: knownAccountID, status: "active" },
            ])
            yield* db.insert(AuthTable).values([
              {
                id: Auth.ID.create(),
                provider: Auth.Provider.make("email"),
                subject: Auth.Sub.make("owner-invite@bymorning.ai"),
                accountId: ownerAccountID,
              },
              {
                id: Auth.ID.create(),
                provider: Auth.Provider.make("email"),
                subject: Auth.Sub.make("known@bymorning.ai"),
                accountId: knownAccountID,
              },
            ])
            yield* db.insert(WorkspaceTable).values({ id: workspaceID, name: "Invitations", status: "active" })
            yield* db.insert(UserTable).values([
              {
                id: ownerUserID,
                accountId: ownerAccountID,
                workspaceId: workspaceID,
                role: "admin",
              },
              {
                id: knownUserID,
                accountId: knownAccountID,
                workspaceId: workspaceID,
                role: "admin",
              },
            ])
          }),
        )

        const pending = yield* users.invite(workspaceID, { email: Auth.Email.make("pending@bymorning.ai"), role: "member" })
        expect(pending).toEqual({
          id: pending.id,
          accountID: null,
          email: "pending@bymorning.ai",
          role: "member",
          status: "pending",
        })
        expect(yield* users.invite(workspaceID, { email: Auth.Email.make("pending@bymorning.ai"), role: "admin" })).toEqual({
          id: pending.id,
          accountID: null,
          email: "pending@bymorning.ai",
          role: "admin",
          status: "pending",
        })
        yield* database.use("UserInviteTest.deletePending", (db) =>
          db
            .update(UserTable)
            .set({ timeDeleted: new Date() })
            .where(eq(UserTable.email, Auth.Email.make("pending@bymorning.ai"))),
        )
        expect(yield* users.invite(workspaceID, { email: Auth.Email.make("pending@bymorning.ai"), role: "member" })).toEqual({
          id: pending.id,
          accountID: null,
          email: "pending@bymorning.ai",
          role: "member",
          status: "pending",
        })
        expect(yield* users.invite(workspaceID, { email: Auth.Email.make("known@bymorning.ai"), role: "member" })).toEqual({
          id: knownUserID,
          accountID: knownAccountID,
          email: "known@bymorning.ai",
          role: "member",
          status: "active",
        })
        expect(yield* users.list(owner)).toEqual({
          role: "admin",
          members: [
            {
              id: ownerUserID,
              accountID: ownerAccountID,
              email: "owner-invite@bymorning.ai",
              role: "admin",
              status: "active",
            },
            {
              id: knownUserID,
              accountID: knownAccountID,
              email: "known@bymorning.ai",
              role: "member",
              status: "active",
            },
            { id: pending.id, accountID: null, email: "pending@bymorning.ai", role: "member", status: "pending" },
          ],
        })
      }).pipe(
        Effect.ensuring(
          Database.Service.use((database) =>
            database.use("UserInviteTest.cleanup", (db) =>
              Effect.gen(function* () {
                yield* db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID))
                yield* db.delete(AccountTable).where(eq(AccountTable.id, ownerAccountID))
                yield* db.delete(AccountTable).where(eq(AccountTable.id, knownAccountID))
              }),
            ),
          ).pipe(Effect.orDie),
        ),
        Effect.provide(testLayer),
      ),
    )
  })
})
