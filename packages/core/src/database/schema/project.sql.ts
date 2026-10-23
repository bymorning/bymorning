import { Project } from "@bymorning/schema/project"
import { Workspace } from "@bymorning/schema/workspace"
import { foreignKey, index, pgTable, primaryKey, text, varchar } from "drizzle-orm/pg-core"
import { timestamps, utc } from "./timestamps.js"
import { WorkspaceTable } from "./workspace.sql.js"

/** Workspace-owned Project persistence table. */
export const ProjectTable = pgTable(
  "project",
  {
    workspaceID: varchar("workspace_id", { length: 30 }).$type<Workspace.ID>().notNull(),
    id: varchar("id", { length: 30 }).$type<Project.ID>().notNull(),
    name: varchar("name", { length: 255 }),
    icon_url: text(),
    icon_url_override: text(),
    icon_color: text(),
    archivedAt: utc("archived_at"),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.workspaceID, table.id], name: "project_pk" }),
    foreignKey({
      columns: [table.workspaceID],
      foreignColumns: [WorkspaceTable.id],
      name: "project_workspace_fk",
    }).onDelete("restrict"),
  ],
)

/**
 * Durable storage-purge intent. Written in the same transaction as the delete
 * that orphans the objects; the purge worker removes every object under the
 * prefix, then deletes the intent. Intents intentionally carry no foreign keys:
 * they must survive the deletion of the rows that created them. A null
 * projectID names the whole Workspace prefix (workspace deletion).
 */
export const ProjectPurgeTable = pgTable(
  "project_purge",
  {
    id: varchar("id", { length: 40 }).primaryKey(),
    workspaceID: varchar("workspace_id", { length: 30 }).$type<Workspace.ID>().notNull(),
    projectID: varchar("project_id", { length: 30 }).$type<Project.ID>(),
    prefix: text().notNull(),
    timeCreated: timestamps.timeCreated,
  },
  (table) => [index("project_purge_created_idx").on(table.timeCreated, table.id)],
)
