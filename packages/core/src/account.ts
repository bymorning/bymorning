import type { GlobalNode } from "@bymorning/util/effect/app-node"
export * as Account from "./account.js"

import { Account } from "@bymorning/schema/account"
import { AccountActor } from "@bymorning/schema/actor"
import { AccountProfile } from "@bymorning/schema/account-profile"
import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "./database.js"
import { AccountTable } from "./database/schema/account.sql.js"
import { AuthTable } from "./database/schema/auth.sql.js"
import { ScheduledTaskTable } from "./database/schema/scheduled-task.sql.js"
import { UserTable } from "./database/schema/user.sql.js"
import { makeGlobalNode } from "@bymorning/util/effect/app-node"
import { Auth } from "./auth.js"
import { OAuth } from "./oauth.js"

/** Durable Account validation authority. */
export interface Interface {
  /** Read the authenticated Account's display information. */
  readonly get: (actor: AccountActor) => Effect.Effect<AccountProfile.Info, UnavailableError | ReadError>
  /** Validate durable Account availability and return canonical Account authority. */
  readonly validate: (actor: AccountActor) => Effect.Effect<AccountActor, UnavailableError>
  /**
   * Suspend the Account installation-wide: authentication, membership
   * selection, and OAuth use are refused on the next request, Login Sessions
   * and OAuth grants are revoked, and the Account's Scheduled Tasks pause.
   * Memberships are untouched. Gated to Installation Admins at the edge.
   */
  readonly suspend: (accountID: Account.ID) => Effect.Effect<void, NotFoundError>
  /** Re-enable a suspended Account's logins; memberships are untouched. */
  readonly restore: (accountID: Account.ID) => Effect.Effect<void, NotFoundError>
}

/** The Account cannot currently authenticate. */
export class UnavailableError extends Schema.TaggedError<UnavailableError>()("Account.UnavailableError", {}) {}

/** Account display information could not be read from persistence. */
export class ReadError extends Schema.TaggedError<ReadError>()("Account.ReadError", {
  cause: Schema.Defect(),
}) {}

/** The requested Account does not exist. */
export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Account.NotFoundError", {
  accountID: Account.ID,
}) {}

/** Durable Account validation authority. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Account") {}

/** Account implementation backed by the shared Database service. */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const auth = yield* Auth.Service
    const oauth = yield* OAuth.Service

    const get = Effect.fn("Account.get")(function* (actor: AccountActor) {
      const [row] = yield* database
        .use("Account.get", (db) =>
          db
            .select({
              id: AccountTable.id,
              email: sql<Auth.Email | null>`coalesce(${AccountTable.email}, ${AuthTable.subject})`,
            })
            .from(AccountTable)
            .leftJoin(
              AuthTable,
              and(
                eq(AuthTable.accountId, AccountTable.id),
                eq(AuthTable.provider, Auth.Provider.make("email")),
                isNull(AuthTable.timeDeleted),
              ),
            )
            .where(
              and(
                eq(AccountTable.id, actor.properties.accountID),
                eq(AccountTable.status, "active"),
                isNull(AccountTable.timeDeleted),
              ),
            )
            // Auth refreshes the asserted email link on each successful login.
            .orderBy(desc(AuthTable.timeUpdated), desc(AuthTable.id))
            .limit(1),
        )
        .pipe(Effect.mapError((cause) => new ReadError({ cause })))
      if (row === undefined) return yield* new UnavailableError({})
      return yield* Schema.decodeUnknownEffect(AccountProfile.Info)(row).pipe(
        Effect.mapError((cause) => new ReadError({ cause })),
      )
    })

    const validate = Effect.fn("Account.validate")(function* (actor: AccountActor) {
      const row = (yield* database.use("Account.validate", (db) =>
        db
          .select({ id: AccountTable.id })
          .from(AccountTable)
          .where(
            and(
              eq(AccountTable.id, actor.properties.accountID),
              eq(AccountTable.status, "active"),
              isNull(AccountTable.timeDeleted),
            ),
          )
          .limit(1)
          .pipe(Effect.orDie),
      ))[0]
      if (row === undefined) return yield* new UnavailableError({})
      return new AccountActor({ type: "account", properties: { accountID: row.id } })
    })

    const suspend = Effect.fn("Account.suspend")(function* (accountID: Account.ID) {
      const changed = yield* database
        .transact(
          Effect.gen(function* () {
            const rows = yield* database.use("Account.suspend", (db) =>
              db
                .update(AccountTable)
                .set({ status: "suspended" })
                .where(
                  and(
                    eq(AccountTable.id, accountID),
                    eq(AccountTable.status, "active"),
                    isNull(AccountTable.timeDeleted),
                  ),
                )
                .returning({ id: AccountTable.id })
                .pipe(Effect.orDie),
            )
            if (rows.length === 0) return false
            // Pause the Account's Scheduled Tasks across every membership.
            const memberships = yield* database.use("Account.suspend.memberships", (db) =>
              db
                .select({ workspaceID: UserTable.workspaceId, userID: UserTable.id })
                .from(UserTable)
                .where(and(eq(UserTable.accountId, accountID), isNull(UserTable.timeDeleted)))
                .pipe(Effect.orDie),
            )
            for (const membership of memberships) {
              yield* database.use("Account.suspend.tasks", (db) =>
                db
                  .update(ScheduledTaskTable)
                  .set({ enabled: false })
                  .where(
                    and(
                      eq(ScheduledTaskTable.workspaceID, membership.workspaceID),
                      eq(ScheduledTaskTable.userID, membership.userID),
                      eq(ScheduledTaskTable.enabled, true),
                    ),
                  )
                  .pipe(Effect.orDie),
              )
            }
            return true
          }),
        )
        .pipe(Effect.catchTag("SqlError", () => Effect.die(new Error("Account persistence failed"))))
      if (!changed) return yield* new NotFoundError({ accountID })
      // Durable Login Sessions and OAuth grants die immediately; the
      // per-request status check already refuses suspended Accounts. The
      // account.suspend Entry is recorded by the edge (Audit.audited).
      yield* auth.revokeAll(accountID)
      yield* oauth.revokeAll(accountID)
    })

    const restore = Effect.fn("Account.restore")(function* (accountID: Account.ID) {
      const changed = yield* database.use("Account.restore", (db) =>
        db
          .update(AccountTable)
          .set({ status: "active" })
          .where(
            and(eq(AccountTable.id, accountID), eq(AccountTable.status, "suspended"), isNull(AccountTable.timeDeleted)),
          )
          .returning({ id: AccountTable.id })
          .pipe(Effect.orDie),
      )
      if (changed.length === 0) return yield* new NotFoundError({ accountID })
      // The account.restore Entry is recorded by the edge (Audit.audited).
    })

    return Service.of({ get, validate, suspend, restore })
  }),
)

export const makeNode = <E>(deps: { readonly database: GlobalNode<Database.Service, E> }) =>
  makeGlobalNode({ service: Service, layer, deps: [deps.database, Auth.node, OAuth.node] })

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, Auth.node, OAuth.node] })
