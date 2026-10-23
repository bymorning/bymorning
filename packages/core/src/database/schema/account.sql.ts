import { Account } from "@bymorning/schema/account"
import { Auth } from "@bymorning/schema/auth"
import { sql } from "drizzle-orm"
import { check, pgTable, primaryKey, text, varchar } from "drizzle-orm/pg-core"
import { timestamps } from "./timestamps.js"

export const AccountTable = pgTable(
  "account",
  {
    id: varchar("id", { length: 30 }).$type<Account.ID>().notNull(),
    status: text({
      enum: ["active", "suspended"],
    })
      .$type<Account.Info["status"]>()
      .notNull(),
    email: varchar("email", { length: 254 }).$type<Auth.Email>(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    check("account_status_check", sql`${table.status} in ('active', 'suspended')`),
  ],
)
