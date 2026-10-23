import { Config } from "@bymorning/schema/config"
import { Workspace } from "@bymorning/schema/workspace"
import { sql } from "drizzle-orm"
import { jsonb, pgTable, varchar } from "drizzle-orm/pg-core"
import { timestamps } from "./timestamps.js"
import { WorkspaceTable } from "./workspace.sql.js"

/** The active stored runtime defaults for each Workspace. */
export const ConfigTable = pgTable("workspace_config", {
  workspaceId: varchar("workspace_id", { length: 30 })
    .$type<Workspace.ID>()
    .notNull()
    .primaryKey()
    .references(() => WorkspaceTable.id, { onDelete: "cascade" }),
  value: jsonb("value")
    .$type<Config.Stored>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  ...timestamps,
})
