import { Skill } from "@bymorning/schema/skill"
import { Workspace } from "@bymorning/schema/workspace"
import { sql } from "drizzle-orm"
import { check, foreignKey, integer, pgTable, primaryKey, text, varchar } from "drizzle-orm/pg-core"
import { timestamps } from "./timestamps.js"
import { WorkspaceTable } from "./workspace.sql.js"

/** Workspace Skill records in stable insertion order. */
export const SkillTable = pgTable(
  "skill",
  {
    workspaceID: varchar("workspace_id", { length: 30 }).$type<Workspace.ID>().notNull(),
    id: varchar("id", { length: 30 }).$type<Skill.ID>().notNull(),
    name: text().$type<Skill.Name>().notNull(),
    description: text().notNull(),
    instructions: text().notNull(),
    list_position: integer().generatedByDefaultAsIdentity().notNull(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.workspaceID, table.id], name: "skill_pk" }),
    foreignKey({
      columns: [table.workspaceID],
      foreignColumns: [WorkspaceTable.id],
      name: "skill_workspace_fk",
    }).onDelete("cascade"),
    check("skill_name_nonempty_check", sql`char_length(${table.name}) > 0`),
  ],
)
