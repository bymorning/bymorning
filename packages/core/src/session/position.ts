/** Session-local chronology allocation. Call only from an owning root transaction. */
import { Effect } from "effect"
import { eq, sql } from "drizzle-orm"
import { type Database, SessionTable } from "../database.js"
import type { Session } from "@bymorning/schema/session"

const maximum = Number.MAX_SAFE_INTEGER

/** Allocate a contiguous, never-reused range in one Session's durable chronology. */
export const allocate = (database: Database.Interface, sessionID: Session.ID, count: number) =>
  database.use("sessionPositionAllocate", (tx) =>
    Effect.gen(function* () {
      if (!Number.isSafeInteger(count) || count < 1)
        return yield* Effect.die(new Error(`Invalid Session position count: ${count}`))
      const rows = yield* tx
        .update(SessionTable)
        .set({ sequence: sql`${SessionTable.sequence} + ${count}` })
        .where(eq(SessionTable.id, sessionID))
        .returning({ sequence: SessionTable.sequence })
      const row = rows[0]
      if (row === undefined || !Number.isSafeInteger(row.sequence) || row.sequence > maximum)
        return yield* Effect.die(new Error(`Session position allocation failed: ${sessionID}`))
      return row.sequence - count + 1
    }),
  ).pipe(Effect.orDie)
