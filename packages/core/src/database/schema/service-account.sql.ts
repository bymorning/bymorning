import { ServiceAccount } from "@bymorning/schema/service-account"
import { Workspace } from "@bymorning/schema/workspace"
import { sql } from "drizzle-orm"
import { check, foreignKey, index, jsonb, pgTable, primaryKey, text, varchar } from "drizzle-orm/pg-core"
import { timestamps } from "./timestamps.js"
import { WorkspaceTable } from "./workspace.sql.js"

export const ServiceAccountTable = pgTable(
  "service_account",
  {
    id: varchar("id", { length: 30 }).$type<ServiceAccount.ID>().notNull(),
    workspaceID: varchar("workspace_id", { length: 30 }).$type<Workspace.ID>().notNull(),
    name: text().notNull(),
    status: text({ enum: ["active", "suspended"] })
      .$type<ServiceAccount.Status>()
      .notNull(),
    policy: jsonb("policy").$type<ServiceAccount.Policy>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.workspaceID, table.id], name: "service_account_pk" }),
    foreignKey({
      columns: [table.workspaceID],
      foreignColumns: [WorkspaceTable.id],
      name: "service_account_workspace_fk",
    }).onDelete("cascade"),
    index("service_account_workspace_deleted_idx").on(table.workspaceID, table.timeDeleted),
    check("service_account_status_check", sql`${table.status} in ('active', 'suspended')`),
  ],
)
