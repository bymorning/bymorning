import { Session } from "@bymorning/schema/session"
import { ServiceAccount } from "@bymorning/schema/service-account"
import type { ID, Source } from "@bymorning/schema/usage"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { sql } from "drizzle-orm"
import { bigint, boolean, check, foreignKey, index, numeric, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core"
import { utc } from "./timestamps.js"
import { ServiceAccountTable } from "./service-account.sql.js"
import { UserTable } from "./user.sql.js"
import { WorkspaceTable } from "./workspace.sql.js"

export const UsageTable = pgTable(
  "usage",
  {
    id: uuid("id").$type<ID>().primaryKey(),
    workspaceID: varchar("workspace_id", { length: 30 }).$type<Workspace.ID>().notNull(),
    userID: varchar("user_id", { length: 30 }).$type<User.ID>(),
    serviceAccountID: varchar("service_account_id", { length: 30 }).$type<ServiceAccount.ID>(),
    sessionID: uuid("session_id").$type<Session.ID>(),
    source: text().$type<Source>().notNull().default("session"),
    request_id: text(),
    endpoint_id: text(),
    upstream_model: text(),
    model: text().notNull(),
    input: bigint("input", { mode: "number" }).notNull(),
    output: bigint("output", { mode: "number" }).notNull(),
    reasoning: bigint("reasoning", { mode: "number" }).notNull(),
    cacheRead: bigint("cache_read", { mode: "number" }).notNull(),
    cacheWrite: bigint("cache_write", { mode: "number" }).notNull(),
    cost: numeric({ precision: 30, scale: 15 }).notNull(),
    costComplete: boolean("cost_complete").notNull().default(true),
    occurredAt: utc("occurred_at").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceID],
      foreignColumns: [WorkspaceTable.id],
      name: "usage_workspace_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceID, table.serviceAccountID],
      foreignColumns: [ServiceAccountTable.workspaceID, ServiceAccountTable.id],
      name: "usage_service_account_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceID, table.userID],
      foreignColumns: [UserTable.workspaceId, UserTable.id],
      name: "usage_user_fk",
    }).onDelete("restrict"),
    index("usage_workspace_occurred_idx").on(table.workspaceID, table.occurredAt),
    index("usage_workspace_user_occurred_idx").on(table.workspaceID, table.userID, table.occurredAt),
    index("usage_workspace_model_occurred_idx").on(table.workspaceID, table.model, table.occurredAt),
    index("usage_workspace_service_account_occurred_idx").on(
      table.workspaceID,
      table.serviceAccountID,
      table.occurredAt,
    ),
    index("usage_workspace_source_occurred_idx").on(table.workspaceID, table.source, table.occurredAt),
    // Gateway inference is attributed to the caller principal the edge
    // authenticated (user or service account, never both); rows predating
    // attribution keep both null. Session observations remain attributed to
    // the Session's User.
    check("usage_principal_check", sql`${table.userID} is null or ${table.serviceAccountID} is null`),
    check("usage_session_principal_check", sql`${table.source} <> 'session' or ${table.userID} is not null`),
    check("usage_source_check", sql`${table.source} in ('session', 'inference')`),
    check("usage_model_nonempty_check", sql`length(${table.model}) > 0`),
    check(
      "usage_nonnegative_check",
      sql`${table.input} >= 0 and ${table.output} >= 0 and ${table.reasoning} >= 0 and ${table.cacheRead} >= 0 and ${table.cacheWrite} >= 0 and ${table.cost} >= 0`,
    ),
  ],
)
