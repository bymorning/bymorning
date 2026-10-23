import type { Budget } from "@bymorning/schema/budget"
import { sql } from "drizzle-orm"
import { check, index, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core"
import { utc } from "./timestamps.js"

/** One Holder's Spend Limit for every Period. Holders are opaque to Budget. */
export const BudgetLimitTable = pgTable(
  "budget_limit",
  {
    holder: text().$type<Budget.Holder>().primaryKey(),
    amount: numeric({ precision: 30, scale: 15 }).notNull(),
    timeUpdated: utc("time_updated").notNull().defaultNow(),
  },
  (table) => [check("budget_limit_amount_check", sql`${table.amount} >= 0`)],
)

/** Settled inference spend against one Holder. Summed per Period at read time. */
export const BudgetChargeTable = pgTable(
  "budget_charge",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    holder: text().$type<Budget.Holder>().notNull(),
    amount: numeric({ precision: 30, scale: 15 }).notNull(),
    occurredAt: utc("occurred_at").notNull(),
  },
  (table) => [
    index("budget_charge_holder_occurred_idx").on(table.holder, table.occurredAt),
    check("budget_charge_amount_check", sql`${table.amount} >= 0`),
  ],
)
