import { Assistant } from "@bymorning/schema/message"
import { SQL, is } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "../../src/database.js"

/**
 * A small transactional Message store: recorder tests exercise the same
 * read/lock/replace boundary as PostgreSQL without depending on its fixture.
 *
 * The row holds the encoded JSON exactly as the `jsonb` column would. Whole-row
 * replacements store the given Assistant; the recorder's coalesced flush,
 * `jsonb_set(data, '{content}', $1)`, replaces only `content` and, like the real
 * statement, matches no row once the Message has completed.
 */
export const recorderDatabase = (initial: Assistant) => {
  let row: Record<string, unknown> = Schema.encodeSync(Assistant)(initial) as Record<string, unknown>
  let writes = 0
  let flushes = 0
  const select = () => {
    const query = {
      from: () => query,
      innerJoin: () => query,
      where: () => query,
      for: () => query,
      limit: () => query,
      pipe: <A>(transform: (effect: Effect.Effect<ReadonlyArray<{ readonly data: unknown }>>) => A) =>
        transform(Effect.sync(() => [{ data: row }])),
    }
    return query
  }
  const update = () => {
    let pending: { readonly data?: unknown } = {}
    const query = {
      set: (value: { readonly data?: unknown }) => {
        pending = value
        return query
      },
      where: () => {
        const data = pending.data
        // The statement runs when either the bare update or its `returning` form is yielded.
        const statement = Effect.sync((): ReadonlyArray<{ readonly id: unknown }> => {
          if (data === undefined) return []
          if (is(data, SQL)) {
            const encoded = data.queryChunks.find((chunk): chunk is string => typeof chunk === "string")
            if (encoded === undefined) throw new Error("Unsupported SQL in recorder test database")
            const time = row.time as { readonly completed?: string } | undefined
            if (time?.completed !== undefined) return []
            writes++
            flushes++
            row = { ...row, content: JSON.parse(encoded) }
            return [{ id: row.id }]
          }
          writes++
          row = Schema.encodeSync(Assistant)(data as Assistant) as Record<string, unknown>
          return [{ id: row.id }]
        })
        return Object.assign(Effect.asVoid(statement), { returning: () => statement })
      },
    }
    return query
  }
  const executor = { select, update }
  return {
    service: Database.Service.of({
      use: (_label, effect) => effect(executor as never),
      transact: (effect) => effect,
      transactRoot: (effect) => effect,
      afterCommit: (effect) => Effect.asVoid(effect),
    }),
    /** The stored Message as a reader such as `Session.messages` would decode it. */
    message: () => Schema.decodeUnknownSync(Assistant)(row),
    /** Every row rewrite, whole or `content`-only. */
    writes: () => writes,
    /** Only the recorder's coalesced `content` flushes. */
    flushes: () => flushes,
  }
}
