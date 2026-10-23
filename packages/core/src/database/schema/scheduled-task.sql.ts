import { Model } from "@bymorning/schema/model"
import { Project } from "@bymorning/schema/project"
import { ScheduledTask } from "@bymorning/schema/scheduled-task"
import { Session } from "@bymorning/schema/session"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { boolean, foreignKey, index, jsonb, pgTable, primaryKey, text, uuid, varchar } from "drizzle-orm/pg-core"
import { ProjectTable } from "./project.sql.js"
import { timestamps, utc } from "./timestamps.js"
import { UserTable } from "./user.sql.js"
import { WorkspaceTable } from "./workspace.sql.js"

export const ScheduledTaskTable = pgTable(
  "scheduled_task",
  {
    workspaceID: varchar("workspace_id", { length: 30 }).$type<Workspace.ID>().notNull(),
    id: varchar("id", { length: 30 }).$type<ScheduledTask.ID>().notNull(),
    userID: varchar("user_id", { length: 30 }).$type<User.ID>().notNull(),
    projectID: varchar("project_id", { length: 30 }).$type<Project.ID>().notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    prompt: text().notNull(),
    cron: varchar("cron", { length: 120 }).notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    model: jsonb("model").$type<Model.Ref>(),
    enabled: boolean("enabled").notNull().default(true),
    nextRunAt: utc("next_run_at"),
    lastRunAt: utc("last_run_at"),
    lastSessionID: uuid("last_session_id").$type<Session.ID>(),
    last_note: text(),
    missedAt: utc("missed_at"),
    timeCreated: timestamps.timeCreated,
    timeUpdated: timestamps.timeUpdated,
  },
  (table) => [
    primaryKey({ columns: [table.workspaceID, table.id], name: "scheduled_task_pk" }),
    foreignKey({
      columns: [table.workspaceID],
      foreignColumns: [WorkspaceTable.id],
      name: "scheduled_task_workspace_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceID, table.userID],
      foreignColumns: [UserTable.workspaceId, UserTable.id],
      name: "scheduled_task_user_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceID, table.projectID],
      foreignColumns: [ProjectTable.workspaceID, ProjectTable.id],
      name: "scheduled_task_project_fk",
    }).onDelete("cascade"),
    index("scheduled_task_user_idx").on(table.workspaceID, table.userID),
    index("scheduled_task_due_idx").on(table.enabled, table.nextRunAt),
  ],
)
