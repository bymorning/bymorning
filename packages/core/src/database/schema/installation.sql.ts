import { Account } from "@bymorning/schema/account"
import { Installation } from "@bymorning/schema/installation"
import { sql } from "drizzle-orm"
import { boolean, check, foreignKey, jsonb, pgTable, primaryKey, text, varchar } from "drizzle-orm/pg-core"
import { AccountTable } from "./account.sql.js"
import { timestamps } from "./timestamps.js"

/**
 * Singleton Installation row: the Installation Policy document and the
 * bootstrap arming flag. Bootstrap is armed on first boot and re-armed when
 * the Setup token is presented, so the next login can become Installation
 * Admin when no admin remains.
 */
export const InstallationTable = pgTable(
  "installation",
  {
    id: text().primaryKey(),
    policy: jsonb("policy").$type<Installation.Policy>().notNull().default({}),
    bootstrapPending: boolean("bootstrap_pending").notNull().default(true),
    timeCreated: timestamps.timeCreated,
    timeUpdated: timestamps.timeUpdated,
  },
  (table) => [check("installation_singleton", sql`${table.id} = 'installation'`)],
)

/** Durable Installation Admin grants, one row per Account. */
export const InstallationAdminTable = pgTable(
  "installation_admin",
  {
    accountId: varchar("account_id", { length: 30 }).$type<Account.ID>().notNull(),
    grantedBy: varchar("granted_by", { length: 30 }).$type<Account.ID>(),
    timeCreated: timestamps.timeCreated,
    timeUpdated: timestamps.timeUpdated,
  },
  (table) => [
    primaryKey({ columns: [table.accountId] }),
    foreignKey({
      columns: [table.accountId],
      foreignColumns: [AccountTable.id],
      name: "installation_admin_account_fk",
    }).onDelete("cascade"),
  ],
)
