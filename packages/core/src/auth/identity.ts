import { Account } from "@bymorning/schema/account"
import { AccountActor } from "@bymorning/schema/actor"
import { Auth } from "@bymorning/schema/auth"
import { and, eq, isNull, sql } from "drizzle-orm"
import { DateTime, Effect } from "effect"
import { Audit } from "../audit.js"
import { Database } from "../database.js"
import { AccountTable } from "../database/schema/account.sql.js"
import { AuthTable } from "../database/schema/auth.sql.js"
import { UserTable } from "../database/schema/user.sql.js"
import { WorkspaceTable } from "../database/schema/workspace.sql.js"
import { Installation } from "../installation.js"
import { Storage } from "../storage.js"
import { RejectedError } from "./error.js"
import { provisionWorkspace } from "./provision.js"

/** Identity facts used to find or create an Account. */
export interface Link {
  readonly provider: Auth.Provider
  readonly sub: Auth.Sub
  readonly email: Auth.Email
  readonly emailVerified: boolean
}

const domainOf = (email: Auth.Email) => email.slice(email.lastIndexOf("@") + 1)

/** Link a verified identity to an Account without using email as an identity key. */
export const link = Effect.fn("Auth.link")(function* (
  database: Database.Interface,
  storage: Storage.Interface,
  installation: Installation.Interface,
  audit: Audit.Interface,
  domains: readonly string[],
  linked: Link,
) {
  if (!linked.emailVerified) {
    return yield* new RejectedError({ reason: "email-unverified", message: "Email is not verified" })
  }
  if (!domains.includes(domainOf(linked.email))) {
    return yield* new RejectedError({ reason: "email-domain", message: "Email domain is not admitted" })
  }
  return yield* database
    .transact(
      Effect.gen(function* () {
        yield* database.use("Auth.lock", (db) =>
          db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`auth:${linked.provider}:${linked.sub}`}, 0))`),
        )
        const existing = (yield* database.use("Auth.links", (db) =>
          db
            .select({ id: AuthTable.id, accountID: AuthTable.accountId })
            .from(AuthTable)
            .where(and(eq(AuthTable.provider, linked.provider), eq(AuthTable.subject, linked.sub)))
            .limit(1),
        ))[0]
        const resolved = yield* existing === undefined
          ? Effect.gen(function* () {
              const account = { id: Account.ID.create(), status: "active" as const, email: linked.email }
              yield* database.use("Auth.provision", (db) =>
                Effect.gen(function* () {
                  yield* db.insert(AccountTable).values(account)
                  yield* db.insert(AuthTable).values({
                    id: Auth.ID.create(),
                    provider: linked.provider,
                    subject: linked.sub,
                    accountId: account.id,
                  })
                }),
              )
              return { account, newlyProvisioned: true }
            })
          : Effect.gen(function* () {
              const available = (yield* database.use("Auth.account", (db) =>
                db
                  .select({ id: AccountTable.id })
                  .from(AccountTable)
                  .where(
                    and(
                      eq(AccountTable.id, existing.accountID),
                      eq(AccountTable.status, "active"),
                      isNull(AccountTable.timeDeleted),
                    ),
                  )
                  .limit(1),
              ))[0]
              if (available === undefined) {
                return yield* new RejectedError({ reason: "account-unavailable", message: "Account is unavailable" })
              }
              const now = yield* DateTime.nowAsDate
              yield* database.use("Auth.refresh", (db) =>
                Effect.gen(function* () {
                  yield* db.update(AuthTable).set({ timeDeleted: null, timeUpdated: now }).where(eq(AuthTable.id, existing.id))
                  yield* db.update(AccountTable).set({ email: linked.email }).where(eq(AccountTable.id, available.id))
                }),
              )
              return { account: available, newlyProvisioned: false }
            })
        const claimed = yield* database.use("Auth.claimInvitations", (db) =>
          db
            .update(UserTable)
            .set({ accountId: resolved.account.id, email: null })
            .where(eq(UserTable.email, linked.email))
            .returning({ id: UserTable.id, workspaceID: UserTable.workspaceId }),
        )
        // Invitation acceptance is recorded with the accepting Account as actor,
        // inside the same transaction as the membership claim. A failed append
        // fails the link like any other persistence failure (fail-closed).
        yield* Effect.forEach(claimed, (membership) =>
          audit.record({
            actor: { type: "account", accountID: resolved.account.id },
            action: "user.accept",
            workspaceID: membership.workspaceID,
            target: membership.id,
            detail: { email: linked.email },
            outcome: "success",
          }),
        ).pipe(Effect.catchTag("Audit.StoreError", () => Effect.die(new Error("Audit persistence failed"))))
        const usableMembership = (yield* database.use("Auth.usableMembership", (db) =>
          db
            .select({ id: UserTable.id })
            .from(UserTable)
            .innerJoin(WorkspaceTable, eq(UserTable.workspaceId, WorkspaceTable.id))
            .where(
              and(
                eq(UserTable.accountId, resolved.account.id),
                isNull(UserTable.timeDeleted),
                eq(WorkspaceTable.status, "active"),
                isNull(WorkspaceTable.timeDeleted),
              ),
            )
            .limit(1),
        ))[0]
        // Bootstrap: the first login after Setup (or after the Setup token is
        // re-presented with no admin remaining) becomes the Installation Admin.
        const bootstrapped = yield* installation.bootstrap(resolved.account.id)
        if (resolved.newlyProvisioned && usableMembership === undefined) {
          const policy = yield* installation.policy.get
          if (bootstrapped || Installation.provisioning(policy) === "open") {
            yield* provisionWorkspace(database, storage, resolved.account.id)
          } else {
            // Invite-only provisioning: a first login without a claimed
            // invitation is refused, rolling back the Account creation.
            return yield* new RejectedError({
              reason: "provisioning",
              message: "Ask an administrator for an invitation",
            })
          }
        }
        return new AccountActor({ type: "account", properties: { accountID: resolved.account.id } })
      }),
    )
    .pipe(
      Effect.catchTags({
        EffectDrizzleQueryError: () => Effect.die(new Error("Auth persistence failed")),
        SqlError: () => Effect.die(new Error("Auth persistence failed")),
      }),
      Effect.catchDefect(() => Effect.die(new Error("Auth persistence failed"))),
    )
})
