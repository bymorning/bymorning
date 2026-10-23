import { Agent } from "@bymorning/schema/agent"
import { Permission } from "@bymorning/schema/permission"
import { Workspace } from "@bymorning/schema/workspace"
import { sql } from "drizzle-orm"
import { boolean, check, foreignKey, integer, jsonb, pgTable, primaryKey, text, varchar } from "drizzle-orm/pg-core"
import { timestamps } from "./timestamps.js"
import { WorkspaceTable } from "./workspace.sql.js"

/** Workspace Agent records in stable insertion order. */
export const AgentTable = pgTable(
  "agent",
  {
    workspaceId: varchar("workspace_id", { length: 30 }).$type<Workspace.ID>().notNull(),
    id: text().$type<Agent.ID>().notNull(),
    name: text().$type<Agent.Name>().notNull(),
    instructions: text().notNull(),
    model: jsonb("model").$type<Agent.Info["model"]>(),
    description: text(),
    mode: text({ enum: ["subagent", "primary", "all"] })
      .$type<Agent.Mode>()
      .notNull(),
    hidden: boolean().notNull(),
    color: text().$type<Agent.Color>(),
    steps: integer().$type<Agent.Steps>(),
    permissions: jsonb("permissions").$type<Permission.Ruleset>().notNull(),
    list_position: integer().generatedByDefaultAsIdentity().notNull(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [WorkspaceTable.id],
      name: "agent_workspace_fk",
    }).onDelete("cascade"),
    check("agent_id_nonempty_check", sql`char_length(${table.id}) > 0`),
    check("agent_name_check", sql`char_length(${table.name}) > 0`),
    check("agent_mode_check", sql`${table.mode} in ('subagent','primary','all')`),
    check("agent_steps_check", sql`${table.steps} is null or ${table.steps} >= 1`),
  ],
)
