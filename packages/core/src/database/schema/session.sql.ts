import { Agent } from "@bymorning/schema/agent"
import { Instruction } from "@bymorning/schema/instruction"
import { MessageSchema } from "@bymorning/schema/message"
import { Model } from "@bymorning/schema/model"
import { Project } from "@bymorning/schema/project"
import { ScheduledTask } from "@bymorning/schema/scheduled-task"
import { Session } from "@bymorning/schema/session"
import { SessionInbox } from "@bymorning/schema/session-inbox"
import { Workspace } from "@bymorning/schema/workspace"
import { User } from "@bymorning/schema/user"
import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core"
import { timestamps, utc } from "./timestamps.js"
import { ProjectTable } from "./project.sql.js"
import { ScheduledTaskTable } from "./scheduled-task.sql.js"
import { WorkspaceTable } from "./workspace.sql.js"
import { UserTable } from "./user.sql.js"

export const SessionTable = pgTable(
  "session",
  {
    id: uuid("id").$type<Session.ID>().primaryKey(),
    workspaceID: varchar("workspace_id", { length: 30 }).$type<Workspace.ID>().notNull(),
    userID: varchar("user_id", { length: 30 }).$type<User.ID>().notNull(),
    projectID: varchar("project_id", { length: 30 }).$type<Project.ID>().notNull(),
    parentID: uuid("parent_id").$type<Session.ID>(),
    title: varchar("title", { length: 255 }).$type<Session.Title>().notNull().default("New session"),
    archivedAt: utc("archived_at"),
    agent: text().$type<Agent.ID>().notNull(),
    model: jsonb("model").$type<Model.Ref>().notNull(),
    scheduledTaskID: varchar("scheduled_task_id", { length: 30 }).$type<ScheduledTask.ID>(),
    usage_cost: numeric({ precision: 30, scale: 15 }).notNull().default("0"),
    usageCostComplete: boolean("usage_cost_complete").notNull().default(true),
    usageTotal: bigint("usage_total", { mode: "bigint" }),
    usageInput: bigint("usage_input", { mode: "bigint" }).notNull().default(0n),
    usageOutput: bigint("usage_output", { mode: "bigint" }).notNull().default(0n),
    usageReasoning: bigint("usage_reasoning", { mode: "bigint" }).notNull().default(0n),
    usageCacheRead: bigint("usage_cache_read", { mode: "bigint" }).notNull().default(0n),
    usageCacheWrite: bigint("usage_cache_write", { mode: "bigint" }).notNull().default(0n),
    sequence: bigint("sequence", { mode: "number" }).notNull().default(0),
    timeCreated: timestamps.timeCreated,
    timeUpdated: timestamps.timeUpdated,
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceID, table.userID],
      foreignColumns: [UserTable.workspaceId, UserTable.id],
      name: "session_user_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceID],
      foreignColumns: [WorkspaceTable.id],
      name: "session_workspace_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceID, table.projectID],
      foreignColumns: [ProjectTable.workspaceID, ProjectTable.id],
      name: "session_project_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceID, table.parentID],
      foreignColumns: [table.workspaceID, table.id],
      name: "session_parent_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceID, table.scheduledTaskID],
      foreignColumns: [ScheduledTaskTable.workspaceID, ScheduledTaskTable.id],
      name: "session_scheduled_task_fk",
      // Sessions survive their Scheduled Task; ScheduledTask.delete detaches
      // them first. A plain "set null" would also null the NOT NULL workspaceID.
    }).onDelete("restrict"),
    uniqueIndex("session_workspace_id_unique").on(table.workspaceID, table.id),
    index("session_project_idx").on(table.workspaceID, table.projectID),
    index("session_user_idx").on(table.workspaceID, table.userID),
    check("session_sequence_check", sql`${table.sequence} >= 0 and ${table.sequence} <= 9007199254740991`),
    index("session_recent_idx").on(table.workspaceID, table.timeUpdated.desc(), table.id.asc()),
    index("session_parent_recent_idx").on(
      table.workspaceID,
      table.parentID,
      table.archivedAt,
      table.timeUpdated.desc(),
      table.id.asc(),
    ),
  ],
)

export const InstructionTable = pgTable(
  "session_instruction",
  {
    sessionID: uuid("session_id")
      .$type<Session.ID>()
      .primaryKey()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    throughSequence: bigint("through_sequence", { mode: "number" }).notNull(),
    initialValues: jsonb("initial_values").$type<Instruction.Values>().notNull(),
    currentValues: jsonb("current_values").$type<Instruction.Values>().notNull(),
  },
)

export const SessionInboxTable = pgTable(
  "session_inbox",
  {
    id: uuid("id").$type<MessageSchema.ID>().primaryKey(),
    sessionID: uuid("session_id")
      .$type<Session.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    admittedSequence: bigint("admitted_sequence", { mode: "number" }).notNull(),
    type: text({ enum: ["user", "synthetic", "compaction"] })
      .$type<SessionInbox.Item["type"]>()
      .notNull(),
    payload: jsonb("payload").$type<SessionInbox.Item["payload"]>().notNull(),
    delivery: text({ enum: ["steer", "queue"] })
      .$type<SessionInbox.Delivery>()
      .notNull(),
    timeCreated: timestamps.timeCreated,
  },
  (table) => [
    uniqueIndex("session_inbox_sequence_idx").on(table.sessionID, table.admittedSequence),
    uniqueIndex("session_inbox_compaction_idx")
      .on(table.sessionID)
      .where(sql`${table.type} = 'compaction'`),
  ],
)

export const SessionMessageTable = pgTable(
  "session_message",
  {
    id: uuid("id").$type<MessageSchema.ID>().primaryKey(),
    sessionID: uuid("session_id")
      .$type<Session.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    type: text({
      enum: ["user", "synthetic", "system", "assistant", "agent-switched", "model-switched", "compaction"],
    }).notNull(),
    data: jsonb("data").$type<MessageSchema.Message>().notNull(),
    timeCreated: timestamps.timeCreated,
    timeUpdated: timestamps.timeUpdated,
  },
  (table) => [
    uniqueIndex("session_message_sequence_idx").on(table.sessionID, table.sequence),
  ],
)
