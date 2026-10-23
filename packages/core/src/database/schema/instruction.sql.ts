import { Instruction } from "@bymorning/schema/instruction"
import { InstructionEntry } from "@bymorning/schema/instruction-entry"
import { Session } from "@bymorning/schema/session"
import { Schema } from "effect"
import { boolean, jsonb, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core"
import { SessionTable } from "./session.sql.js"
import { timestamps } from "./timestamps.js"

export const InstructionBlobTable = pgTable("instruction_blob", {
  hash: text().$type<Instruction.Hash>().primaryKey(),
  value: jsonb("value").$type<Schema.Json>().notNull(),
})

export const InstructionEntryTable = pgTable(
  "instruction_entry",
  {
    sessionID: uuid("session_id")
      .$type<Session.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    key: text().$type<InstructionEntry.Key>().notNull(),
    value: jsonb("value").$type<Schema.Json | null>(),
    removed: boolean("removed").notNull().default(false),
    timeCreated: timestamps.timeCreated,
    timeUpdated: timestamps.timeUpdated,
  },
  (table) => [primaryKey({ columns: [table.sessionID, table.key] })],
)
