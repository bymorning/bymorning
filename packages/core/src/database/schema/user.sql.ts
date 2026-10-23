import { Account } from "@bymorning/schema/account"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { sql } from "drizzle-orm"
import { check, foreignKey, index, pgTable, primaryKey, text, uniqueIndex, varchar } from "drizzle-orm/pg-core"
import { timestamps } from "./timestamps.js"
import { AccountTable } from "./account.sql.js"
import { WorkspaceTable } from "./workspace.sql.js"

export const UserTable = pgTable(
  "user",
  {
    id: varchar("id", { length: 30 }).$type<User.ID>().notNull(),
    workspaceId: varchar("workspace_id", { length: 30 }).$type<Workspace.ID>().notNull(),
    accountId: varchar("account_id", { length: 30 }).$type<Account.ID>(),
    email: varchar("email", { length: 254 }).$type<User.Info["email"]>(),
    role: text({
      enum: ["admin", "member"],
    })
      .$type<User.Info["role"]>()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [WorkspaceTable.id],
      name: "user_workspace_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.accountId],
      foreignColumns: [AccountTable.id],
      name: "user_account_fk",
    }).onDelete("cascade"),
    uniqueIndex("user_account_id").on(table.workspaceId, table.accountId),
    uniqueIndex("user_email").on(table.workspaceId, table.email),
    index("global_account_id").on(table.accountId),
    check("user_role_check", sql`${table.role} in ('admin', 'member')`),
  ],
)
