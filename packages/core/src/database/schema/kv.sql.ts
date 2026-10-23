import { jsonb, pgTable, text } from "drizzle-orm/pg-core"
import type { KV } from "../../kv.js"
import { timestamps } from "./timestamps.js"

/** Persistent JSON entries addressed by a unique key. */
export const KVTable = pgTable("kv", {
  key: text().primaryKey(),
  value: jsonb().$type<KV.Value>().notNull(),
  ...timestamps,
})
