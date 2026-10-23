import type { GlobalNode } from "@bymorning/util/effect/app-node"
export * as User from "./user.js"

import { Workspace } from "@bymorning/schema/workspace"
import { AccountActor, UserActor } from "@bymorning/schema/actor"
import { Auth } from "@bymorning/schema/auth"
import { ID, type InviteInput, type Member, type MemberList, type Status } from "@bymorning/schema/user"
import { and, asc, eq, isNull, or, sql } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Database } from "./database.js"
import { AccountTable } from "./database/schema/account.sql.js"
import { AuthTable } from "./database/schema/auth.sql.js"
import { CredentialTable } from "./database/schema/credential.sql.js"
import { OAuthGrantTable } from "./database/schema/oauth.sql.js"
import { ScheduledTaskTable } from "./database/schema/scheduled-task.sql.js"
import { UserTable } from "./database/schema/user.sql.js"
import { WorkspaceTable } from "./database/schema/workspace.sql.js"
import { makeGlobalNode } from "@bymorning/util/effect/app-node"

/** Account membership selection authority. */
export interface Interface {
  /** Select one exact membership or the stable oldest usable membership. */
  readonly select: (input: SelectInput) => Effect.Effect<UserActor, AccessError>
  /**
   * Invite or reinvite a member after the caller has authorized access to the Workspace.
   * Refuses a reinvitation that would demote the Workspace's last admin.
   */
  readonly invite: (
    workspaceID: Workspace.ID,
    input: InviteInput,
  ) => Effect.Effect<Member, InviteError | LastAdminError>
  /** List active and pending memberships in the authenticated User's Workspace. */
  readonly list: (actor: UserActor) => Effect.Effect<MemberList>
  /**
   * Soft-delete one membership, revoke the member's OAuth grants for the
   * Workspace, delete the member's own Connections in it, and pause the
   * member's Scheduled Tasks. The member's Sessions
   * are retained. Refuses to remove the Workspace's last admin.
   */
  readonly remove: (workspaceID: Workspace.ID, userID: ID) => Effect.Effect<void, NotFoundError | LastAdminError>
}

export interface SelectInput {
  readonly account: AccountActor
  readonly workspaceID?: Workspace.ID
}

/** The requested Workspace authority is unavailable. */
export class AccessError extends Schema.TaggedError<AccessError>()("User.AccessError", {
  reason: Schema.Literals(["membership-unavailable", "workspace-unavailable"]),
}) {}

/** A Workspace invitation could not be persisted. */
export class InviteError extends Schema.TaggedError<InviteError>()("User.InviteError", {
  reason: Schema.Literal("persistence-unavailable"),
}) {}

/** The requested membership does not exist in the Workspace. */
export class NotFoundError extends Schema.TaggedError<NotFoundError>()("User.NotFoundError", {
  userID: ID,
}) {}

/** The Workspace's last admin cannot be removed or demoted. */
export class LastAdminError extends Schema.TaggedError<LastAdminError>()("User.LastAdminError", {}) {}

/** Account membership selection service. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/User") {}

/** User implementation backed by the shared Database service. */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const select = Effect.fn("User.select")(function* (input: SelectInput) {
      const accountID = input.account.properties.accountID
      const where = [
        eq(UserTable.accountId, accountID),
        isNull(UserTable.timeDeleted),
        eq(AccountTable.id, accountID),
        eq(AccountTable.status, "active"),
        isNull(AccountTable.timeDeleted),
        eq(WorkspaceTable.status, "active"),
        isNull(WorkspaceTable.timeDeleted),
      ]
      if (input.workspaceID !== undefined) where.push(eq(UserTable.workspaceId, input.workspaceID))
      const row = (yield* database.use("User.select", (db) =>
        db
          .select({
            accountID: AccountTable.id,
            userID: UserTable.id,
            workspaceID: UserTable.workspaceId,
            role: UserTable.role,
          })
          .from(UserTable)
          .innerJoin(AccountTable, eq(UserTable.accountId, AccountTable.id))
          .innerJoin(WorkspaceTable, eq(UserTable.workspaceId, WorkspaceTable.id))
          .where(and(...where))
          .orderBy(asc(UserTable.timeCreated), asc(UserTable.id))
          .limit(1)
          .pipe(Effect.orDie),
      ))[0]
      if (row === undefined) {
        return yield* new AccessError({
          reason: input.workspaceID === undefined ? "membership-unavailable" : "workspace-unavailable",
        })
      }
      return new UserActor({ type: "user", properties: row })
    })

    const list = Effect.fn("User.list")(function* (actor: UserActor) {
      const members = yield* database.use("User.list", (db) =>
        db
          .select({
            id: UserTable.id,
            email: sql<Auth.Email>`coalesce(${UserTable.email}, ${AccountTable.email}, ${AuthTable.subject})`,
            role: UserTable.role,
            status: sql<Status>`case when ${UserTable.accountId} is null then 'pending' else 'active' end`,
            accountID: UserTable.accountId,
          })
          .from(UserTable)
          .leftJoin(
            AuthTable,
            and(
              eq(UserTable.accountId, AuthTable.accountId),
              eq(AuthTable.provider, Auth.Provider.make("email")),
              isNull(AuthTable.timeDeleted),
            ),
          )
          .leftJoin(AccountTable, eq(UserTable.accountId, AccountTable.id))
          .where(
            and(
              eq(UserTable.workspaceId, actor.properties.workspaceID),
              isNull(UserTable.timeDeleted),
              or(isNull(UserTable.accountId), and(eq(AccountTable.status, "active"), isNull(AccountTable.timeDeleted))),
            ),
          )
          .orderBy(asc(UserTable.timeCreated), asc(UserTable.id))
          .pipe(Effect.orDie),
      )
      return { role: actor.properties.role, members }
    })

    /**
     * Fails with LastAdminError when `userID` is the Workspace's only remaining admin. Locks the
     * Workspace's admin rows (in id order) for the rest of the transaction so concurrent demotions
     * or removals serialize and cannot each see the other as the remaining admin.
     */
    const lastAdmin = (workspaceID: Workspace.ID, userID: ID) =>
      database
        .use("User.lastAdmin", (db) =>
          db
            .select({ id: UserTable.id })
            .from(UserTable)
            .where(
              and(eq(UserTable.workspaceId, workspaceID), eq(UserTable.role, "admin"), isNull(UserTable.timeDeleted)),
            )
            .orderBy(asc(UserTable.id))
            .for("update"),
        )
        .pipe(
          Effect.flatMap((admins) =>
            admins.some((admin) => admin.id === userID) && admins.every((admin) => admin.id === userID)
              ? Effect.fail(new LastAdminError({}))
              : Effect.void,
          ),
        )

    const invite = Effect.fn("User.invite")(
      function* (workspaceID: Workspace.ID, input: InviteInput) {
        const account =
          (yield* database.use("User.inviteAccount", (db) =>
            db
              .select({ id: AccountTable.id })
              .from(AccountTable)
              .where(
                and(
                  eq(AccountTable.email, input.email),
                  eq(AccountTable.status, "active"),
                  isNull(AccountTable.timeDeleted),
                ),
              )
              .limit(1),
          ))[0] ??
          (yield* database.use("User.inviteAccountLink", (db) =>
            db
              .select({ id: AuthTable.accountId })
              .from(AuthTable)
              .where(
                and(
                  eq(AuthTable.provider, Auth.Provider.make("email")),
                  eq(AuthTable.subject, Auth.Sub.make(input.email)),
                ),
              )
              .limit(1),
          ))[0]
        const member = (yield* database.transact(
          Effect.gen(function* () {
            if (input.role !== "admin") {
              // A reinvitation may change a Role, but never strips the last admin.
              const current = (yield* database.use("User.inviteCurrent", (db) =>
                db
                  .select({ id: UserTable.id, role: UserTable.role })
                  .from(UserTable)
                  .where(
                    and(
                      eq(UserTable.workspaceId, workspaceID),
                      account === undefined ? eq(UserTable.email, input.email) : eq(UserTable.accountId, account.id),
                      isNull(UserTable.timeDeleted),
                    ),
                  )
                  .limit(1),
              ))[0]
              if (current?.role === "admin") yield* lastAdmin(workspaceID, current.id)
            }
            return yield* database.use("User.inviteSave", (db) =>
              account === undefined
                ? db
                    .insert(UserTable)
                    .values({
                      id: ID.create(),
                      workspaceId: workspaceID,
                      accountId: null,
                      email: input.email,
                      role: input.role,
                    })
                    .onConflictDoUpdate({
                      target: [UserTable.workspaceId, UserTable.email],
                      set: { role: input.role, timeDeleted: null },
                    })
                    .returning({ id: UserTable.id, accountID: UserTable.accountId, role: UserTable.role })
                : db
                    .insert(UserTable)
                    .values({
                      id: ID.create(),
                      workspaceId: workspaceID,
                      accountId: account.id,
                      email: null,
                      role: input.role,
                    })
                    .onConflictDoUpdate({
                      target: [UserTable.workspaceId, UserTable.accountId],
                      set: { role: input.role, timeDeleted: null },
                    })
                    .returning({ id: UserTable.id, accountID: UserTable.accountId, role: UserTable.role }),
            )
          }),
        ))[0]
        if (member === undefined) return yield* new InviteError({ reason: "persistence-unavailable" })

        return {
          id: member.id,
          email: input.email,
          role: member.role,
          status: member.accountID === null ? ("pending" as const) : ("active" as const),
          accountID: member.accountID,
        }
      },
      Effect.catchTags({
        EffectDrizzleQueryError: () => new InviteError({ reason: "persistence-unavailable" }),
        SqlError: () => new InviteError({ reason: "persistence-unavailable" }),
      }),
    )

    const remove = Effect.fn("User.remove")(function* (workspaceID: Workspace.ID, userID: ID) {
      yield* database
        .transact(
          Effect.gen(function* () {
            const member = (yield* database.use("User.remove.member", (db) =>
              db
                .select({
                  id: UserTable.id,
                  accountID: UserTable.accountId,
                  role: UserTable.role,
                })
                .from(UserTable)
                .where(
                  and(eq(UserTable.workspaceId, workspaceID), eq(UserTable.id, userID), isNull(UserTable.timeDeleted)),
                )
                .limit(1)
                .pipe(Effect.orDie),
            ))[0]
            if (member === undefined) return yield* new NotFoundError({ userID })
            if (member.role === "admin") yield* lastAdmin(workspaceID, userID)
            const now = yield* DateTime.nowAsDate
            yield* database.use("User.remove.delete", (db) =>
              db
                .update(UserTable)
                .set({ timeDeleted: now })
                .where(and(eq(UserTable.workspaceId, workspaceID), eq(UserTable.id, userID)))
                .pipe(Effect.orDie),
            )
            if (member.accountID !== null) {
              // Member removal is Workspace-scoped: the member's grants for this
              // Workspace are deleted with the membership, which the next token
              // use enforces. Account-wide grant revocation is suspension's path.
              yield* database.use("User.remove.grants", (db) =>
                db
                  .delete(OAuthGrantTable)
                  .where(
                    and(eq(OAuthGrantTable.workspaceId, workspaceID), eq(OAuthGrantTable.accountId, member.accountID!)),
                  )
                  .pipe(Effect.orDie),
              )
            }
            // The member's own Connections (OAuth tokens, Member Values) end with
            // the membership; they are never available to anyone else.
            yield* database.use("User.remove.credentials", (db) =>
              db
                .delete(CredentialTable)
                .where(and(eq(CredentialTable.workspaceId, workspaceID), eq(CredentialTable.userID, userID)))
                .pipe(Effect.orDie),
            )
            // Removed members keep their Sessions (Workspace records); their
            // Scheduled Tasks pause rather than delete.
            yield* database.use("User.remove.tasks", (db) =>
              db
                .update(ScheduledTaskTable)
                .set({ enabled: false })
                .where(
                  and(
                    eq(ScheduledTaskTable.workspaceID, workspaceID),
                    eq(ScheduledTaskTable.userID, userID),
                    eq(ScheduledTaskTable.enabled, true),
                  ),
                )
                .pipe(Effect.orDie),
            )
          }),
        )
        .pipe(
          Effect.catchTags({
            EffectDrizzleQueryError: () => Effect.die(new Error("User persistence failed")),
            SqlError: () => Effect.die(new Error("User persistence failed")),
          }),
        )
      // The user.remove Entry is recorded by the edge (Audit.audited).
    })

    return Service.of({ select, invite, list, remove })
  }),
)

export const makeNode = <E>(deps: { readonly database: GlobalNode<Database.Service, E> }) =>
  makeGlobalNode({ service: Service, layer, deps: [deps.database] })

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
