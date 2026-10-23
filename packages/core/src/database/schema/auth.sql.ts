import { Account } from "@bymorning/schema/account"
import { Auth } from "@bymorning/schema/auth"
import { foreignKey, index, pgTable, uniqueIndex, varchar } from "drizzle-orm/pg-core"
import { AccountTable } from "./account.sql.js"
import { timestamps, utc } from "./timestamps.js"

export const AuthTable = pgTable(
  "auth",
  {
    id: varchar("id", { length: 30 }).$type<Auth.ID>().primaryKey(),
    provider: varchar("provider", { length: 255 }).$type<Auth.Provider>().notNull(),
    subject: varchar("subject", { length: 255 }).$type<Auth.Sub>().notNull(),
    accountId: varchar("account_id", { length: 30 }).$type<Account.ID>().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("auth_provider_subject_unique").on(table.provider, table.subject),
    index("auth_account_idx").on(table.accountId),
    foreignKey({
      columns: [table.accountId],
      foreignColumns: [AccountTable.id],
      name: "auth_account_fk",
    }).onDelete("cascade"),
  ],
)

/**
 * Durable Login Session record. The signed cookie payload (Auth.Session v2)
 * carries the identity and absolute expiry; revocation and idle state live
 * only here, so a replayed cookie is refused once this row is revoked or its
 * idle or absolute bound has passed.
 */
export const LoginSessionTable = pgTable(
  "login_session",
  {
    id: varchar("id", { length: 30 }).$type<Auth.SessionID>().primaryKey(),
    accountId: varchar("account_id", { length: 30 }).$type<Account.ID>().notNull(),
    /** Absolute expiry fixed at issuance; mirrors the cookie payload. */
    timeExpires: utc("time_expires").notNull(),
    /** Idle expiry; extended by activity touches at most once per minute. */
    timeIdleExpires: utc("time_idle_expires").notNull(),
    /** Last activity touch; bounds idle write amplification. */
    timeTouched: utc("time_touched").notNull(),
    /** Set when the session is ended, revoked, or cascaded away; the row is retained. */
    timeRevoked: utc("time_revoked"),
    ...timestamps,
  },
  (table) => [
    index("login_session_account_idx").on(table.accountId),
    foreignKey({
      columns: [table.accountId],
      foreignColumns: [AccountTable.id],
      name: "login_session_account_fk",
    }).onDelete("cascade"),
  ],
)
