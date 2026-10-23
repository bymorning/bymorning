/** Retention pruning: the only deletion path for the append-only Entry stream. */
import { DateTime, Effect } from "effect"
import type { Database } from "../database.js"
import { writePrune } from "./emit.js"
import type { make } from "./store.js"

/** How often the process retention job runs; it also runs once at boot. */
export const intervalHours = 24

/**
 * Delete every Entry older than the retention window, emitting one summary
 * stderr line before deleting. The deletion line is unconditional (not gated
 * by `AUDIT_STDOUT`): it is the evidence that records left the stream.
 */
export const run = <E>(
  database: Database.Interface,
  store: ReturnType<typeof make>,
  retentionDays: number,
  storeError: (cause: unknown) => E,
) =>
  Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate
    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000)
    const deleted = yield* store.countBefore(cutoff).pipe(Effect.mapError(storeError))
    if (deleted === 0) return { deleted: 0 }
    yield* writePrune({ deleted, cutoff })
    yield* database.transact(store.deleteBefore(cutoff)).pipe(Effect.mapError(storeError))
    return { deleted }
  })
