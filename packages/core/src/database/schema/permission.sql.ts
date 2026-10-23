import { Permission } from "@bymorning/schema/permission"
import { Workspace } from "@bymorning/schema/workspace"
import { foreignKey, pgTable, primaryKey, text, uniqueIndex, varchar } from "drizzle-orm/pg-core"
import { WorkspaceTable } from "./workspace.sql.js"

/** Workspace-retained Permission allow grants. */
export const PermissionSavedTable = pgTable(
  "permission_saved",
  {
    id: varchar("id", { length: 30 }).$type<Permission.SavedID>().notNull(),
    workspaceId: varchar("workspace_id", { length: 30 }).$type<Workspace.ID>().notNull(),
    action: text().notNull(),
    resource: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [WorkspaceTable.id],
      name: "permission_saved_workspace_fk",
    }).onDelete("cascade"),
    uniqueIndex("permission_saved_workspace_grant").on(table.workspaceId, table.action, table.resource),
  ],
)
