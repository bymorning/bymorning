export * as KV from "./kv.js"

import { and, asc, eq, gt, gte, lt, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "./database.js"
import { makeGlobalNode } from "@bymorning/util/effect/app-node"
import { KVTable } from "./database/schema/kv.sql.js"

export type Value = Schema.Json

export interface Entry {
  readonly key: string
  readonly value: Value
}

export interface ScanOptions {
  readonly prefix: string
  readonly after?: string
  readonly limit?: number
}

export interface ScanResult {
  readonly entries: readonly Entry[]
  readonly next?: string
}

export interface Interface {
  readonly get: (key: string) => Effect.Effect<Value | undefined>
  readonly set: (key: string, value: Value) => Effect.Effect<void>
  readonly remove: (key: string) => Effect.Effect<void>
  readonly scan: (options: ScanOptions) => Effect.Effect<ScanResult>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/core/KV") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    return Service.of({
      get: Effect.fn("KV.get")(function* (key) {
        const rows = yield* database.use("KV.get", (db) => db
          .select({ value: KVTable.value })
          .from(KVTable)
          .where(eq(KVTable.key, key))
          .limit(1)
          .pipe(Effect.orDie))
        return rows[0]?.value
      }),
      set: Effect.fn("KV.set")(function* (key, value) {
        yield* database.use("KV.set", (db) => db
          .insert(KVTable)
          .values({ key, value })
          .onConflictDoUpdate({ target: KVTable.key, set: { value, timeUpdated: new Date() } })
          .pipe(Effect.orDie))
      }),
      remove: Effect.fn("KV.remove")(function* (key) {
        yield* database.use("KV.remove", (db) => db.delete(KVTable).where(eq(KVTable.key, key)).pipe(Effect.orDie))
      }),
      scan: Effect.fn("KV.scan")(function* (options) {
        const limit = Number.isNaN(options.limit) ? 100 : Math.min(Math.max(Math.floor(options.limit ?? 100), 1), 1000)
        const end = prefixEnd(options.prefix)
        // Prefix bounds require code-point ordering rather than locale-aware PostgreSQL ordering.
        const key = sql`${KVTable.key} collate "C"`
        const rows = yield* database.use("KV.scan", (db) => db
          .select({ key: KVTable.key, value: KVTable.value })
          .from(KVTable)
          .where(
            and(
              options.prefix === "" ? undefined : gte(key, options.prefix),
              end === undefined ? undefined : lt(key, end),
              options.after === undefined ? undefined : gt(key, options.after),
            ),
          )
          .orderBy(asc(key))
          .limit(limit + 1)
          .pipe(Effect.orDie))
        const entries = rows.slice(0, limit)
        if (rows.length <= limit) return { entries }
        return { entries, next: entries[entries.length - 1]!.key }
      }),
    })
  }),
)

function prefixEnd(prefix: string) {
  const points = Array.from(prefix)
  const index = points.findLastIndex((value) => value.codePointAt(0)! < 0x10ffff)
  if (index < 0) return undefined
  return `${points.slice(0, index).join("")}${String.fromCodePoint(points[index]!.codePointAt(0)! + 1)}`
}

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
