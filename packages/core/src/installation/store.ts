import { Account } from "@bymorning/schema/account"
import { Installation } from "@bymorning/schema/installation"
import { asc, eq } from "drizzle-orm"
import { Effect } from "effect"
import type { Database } from "../database.js"
import { InstallationAdminTable, InstallationTable } from "../database/schema/installation.sql.js"

const singleton = "installation"

/** Row-level Installation persistence shared by the Installation service operations. */
export const makeStore = (database: Database.Interface) => {
  const readState = (lock: boolean) =>
    database.use("Installation.state", (db) => {
      const selection = db.select().from(InstallationTable).where(eq(InstallationTable.id, singleton)).limit(1)
      return (lock ? selection.for("update") : selection).pipe(
        Effect.orDie,
        Effect.map((rows) => rows[0]),
      )
    })

  const ensureState = database
    .use("Installation.ensure", (db) =>
      db.insert(InstallationTable).values({ id: singleton }).onConflictDoNothing().pipe(Effect.orDie),
    )
    .pipe(Effect.andThen(readState(true)))

  const readPolicy = database.use("Installation.policy", (db) =>
    db
      .select({ policy: InstallationTable.policy })
      .from(InstallationTable)
      .where(eq(InstallationTable.id, singleton))
      .limit(1)
      .pipe(
        Effect.orDie,
        Effect.map((rows) => rows[0]?.policy),
      ),
  )

  const writePolicy = (policy: Installation.Policy) =>
    database.use("Installation.writePolicy", (db) =>
      db
        .insert(InstallationTable)
        .values({ id: singleton, policy })
        .onConflictDoUpdate({ target: [InstallationTable.id], set: { policy } })
        .pipe(Effect.orDie),
    )

  const setBootstrap = (pending: boolean) =>
    database.use("Installation.bootstrap", (db) =>
      db
        .insert(InstallationTable)
        .values({ id: singleton, bootstrapPending: pending })
        .onConflictDoUpdate({ target: [InstallationTable.id], set: { bootstrapPending: pending } })
        .pipe(Effect.orDie),
    )

  const listAdmins = database.use("Installation.admins", (db) =>
    db
      .select({ accountID: InstallationAdminTable.accountId })
      .from(InstallationAdminTable)
      .orderBy(asc(InstallationAdminTable.timeCreated), asc(InstallationAdminTable.accountId))
      .pipe(Effect.orDie),
  )

  const insertAdmin = (accountID: Account.ID, grantedBy?: Account.ID) =>
    database.use("Installation.grant", (db) =>
      db
        .insert(InstallationAdminTable)
        .values({ accountId: accountID, ...(grantedBy === undefined ? {} : { grantedBy }) })
        .onConflictDoNothing()
        .pipe(Effect.orDie),
    )

  const deleteAdmin = (accountID: Account.ID) =>
    database.use("Installation.revoke", (db) =>
      db.delete(InstallationAdminTable).where(eq(InstallationAdminTable.accountId, accountID)).pipe(Effect.orDie),
    )

  return { readState, ensureState, readPolicy, writePolicy, setBootstrap, listAdmins, insertAdmin, deleteAdmin }
}
