import { Workspace } from "@bymorning/schema/workspace"
import { sql } from "drizzle-orm"
import { check, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core"
import { timestamps } from "./timestamps.js"

export const WorkspaceTable = pgTable(
  "workspace",
  {
    id: varchar("id", { length: 30 }).$type<Workspace.ID>().notNull().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }),
    status: text({
      enum: ["active", "suspended"],
    })
      .$type<Workspace.Info["status"]>()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("workspace_slug_unique").on(table.slug),
    check("workspace_slug_nonempty_check", sql`${table.slug} is null or length(${table.slug}) > 0`),
    check("workspace_status_check", sql`${table.status} in ('active', 'suspended')`),
  ],
)
