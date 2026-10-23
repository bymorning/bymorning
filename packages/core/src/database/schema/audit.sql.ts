import { Audit } from "@bymorning/schema/audit"
import type { Account } from "@bymorning/schema/account"
import type { Workspace } from "@bymorning/schema/workspace"
import { sql } from "drizzle-orm"
import { bigint, check, index, jsonb, pgTable, text, varchar } from "drizzle-orm/pg-core"
import { utc } from "./timestamps.js"

/**
 * Append-only Audit Entry stream. The table has no update or delete lifecycle
 * columns; the Audit retention pruner is the only deleter, and no Core service
 * issues UPDATE statements against it. `account_id` is a denormalized filter
 * projection of the `actor` principal.
 */
export const AuditEntryTable = pgTable(
  "audit_entry",
  {
    id: varchar("id", { length: 40 }).$type<Audit.ID>().primaryKey(),
    sequence: bigint("sequence", { mode: "number" }).generatedAlwaysAsIdentity(),
    occurredAt: utc("occurred_at").notNull(),
    actor: jsonb("actor").$type<Audit.Principal>().notNull(),
    accountId: varchar("account_id", { length: 30 }).$type<Account.ID>(),
    workspaceId: varchar("workspace_id", { length: 30 }).$type<Workspace.ID>(),
    action: text().$type<Audit.Action>().notNull(),
    target: text(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    outcome: text().$type<Audit.Outcome>().notNull(),
    ip: text(),
    user_agent: text(),
    chain: text().notNull(),
  },
  (table) => [
    check("audit_entry_outcome_check", sql`${table.outcome} in ('success', 'failure')`),
    index("audit_entry_workspace_sequence").on(table.workspaceId, table.sequence),
    index("audit_entry_account_sequence").on(table.accountId, table.sequence),
    index("audit_entry_occurred_at").on(table.occurredAt),
  ],
)
