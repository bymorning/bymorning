import { Session } from "@bymorning/schema/session"
import { ToolUsage } from "@bymorning/schema/tool-usage"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { sql } from "drizzle-orm"
import { check, foreignKey, index, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core"
import { utc } from "./timestamps.js"
import { UserTable } from "./user.sql.js"
import { WorkspaceTable } from "./workspace.sql.js"

export const ToolUsageTable = pgTable(
  "tool_usage",
  {
    id: uuid("id").$type<ToolUsage.ID>().primaryKey(),
    workspaceID: varchar("workspace_id", { length: 30 }).$type<Workspace.ID>().notNull(),
    userID: varchar("user_id", { length: 30 }).$type<User.ID>().notNull(),
    sessionID: uuid("session_id").$type<Session.ID>(),
    tool: text().notNull(),
    status: text({ enum: ["completed", "error"] }).notNull(),
    occurredAt: utc("occurred_at").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceID],
      foreignColumns: [WorkspaceTable.id],
      name: "tool_usage_workspace_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceID, table.userID],
      foreignColumns: [UserTable.workspaceId, UserTable.id],
      name: "tool_usage_user_fk",
    }).onDelete("restrict"),
    index("tool_usage_workspace_occurred_idx").on(table.workspaceID, table.occurredAt.desc(), table.id.asc()),
    index("tool_usage_workspace_user_occurred_idx").on(
      table.workspaceID,
      table.userID,
      table.occurredAt.desc(),
      table.id.asc(),
    ),
    index("tool_usage_workspace_session_occurred_idx")
      .on(table.workspaceID, table.sessionID, table.occurredAt.desc(), table.id.asc())
      .where(sql`${table.sessionID} is not null`),
    check("tool_usage_tool_nonempty_check", sql`length(${table.tool}) > 0`),
    check("tool_usage_status_check", sql`${table.status} in ('completed', 'error')`),
  ],
)
