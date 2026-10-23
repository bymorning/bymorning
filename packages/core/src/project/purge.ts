/**
 * Durable storage purge for deleted Projects (and, eventually, Workspaces).
 * `Project.delete` writes an intent row in the same transaction; this worker —
 * run at boot and on the host's interval — removes every object under the
 * intent's prefix, then deletes the intent. Intents outlive crashes: an
 * undrained intent is retried by the next drain, and a drain that fails keeps
 * the intent and emits the `Project.purge failed` log line the installer alarms on.
 *
 * Object removal is idempotent, so concurrent drains need no locking: the
 * intent row is deleted only after its objects are gone.
 */
import { asc, eq } from "drizzle-orm"
import { Effect } from "effect"
import { Audit } from "../audit.js"
import { Database, ProjectPurgeTable } from "../database.js"
import { Storage } from "../storage.js"

/** Intents drained per pass; the remainder waits for the next pass. */
const batch = 100

/**
 * Reconstruct the Storage path addressing one listed object key. Marker keys
 * end in `/` and must be rebuilt with a trailing named pair to keep the exact
 * key (see serializePath).
 */
const keyPath = (key: string): Storage.Path => {
  if (!key.endsWith("/")) return key.split("/")
  const segments = key.slice(0, -1).split("/")
  const value = segments[segments.length - 1]
  const name = segments[segments.length - 2]
  if (value === undefined || name === undefined) return segments
  return [...segments.slice(0, -2), { [name]: value }]
}

/** Remove every object under one intent's prefix, then the intent itself. */
const purge = Effect.fn("Project.purge.intent")(function* (intent: typeof ProjectPurgeTable.$inferSelect) {
  const { object: storage } = yield* Storage.Service
  const database = yield* Database.Service
  const audit = yield* Audit.Service
  const objects = yield* storage.list(
    intent.projectID === null
      ? [{ workspaces: intent.workspaceID }]
      : [{ workspaces: intent.workspaceID }, { projects: intent.projectID }],
  )
  yield* Effect.forEach(objects, (item) => storage.remove(keyPath(item.key)), { discard: true })
  // The file.delete summary Entry commits with the intent deletion: a stuck
  // drain never claims a completed purge it has not recorded (fail-closed).
  yield* database.transact(
    Effect.gen(function* () {
      yield* database.use("Project.purge.delete", (db) =>
        db.delete(ProjectPurgeTable).where(eq(ProjectPurgeTable.id, intent.id)),
      )
      yield* audit.record({
        actor: Audit.system(intent.workspaceID),
        action: "file.delete",
        workspaceID: intent.workspaceID,
        target: intent.projectID ?? intent.id,
        detail: { prefix: intent.prefix, objects: objects.length, purgeID: intent.id },
        outcome: "success",
      })
    }),
  )
})

/**
 * Drain persisted purge intents, oldest first. Per-intent failures are logged
 * and left for the next drain; they never fail the pass.
 */
export const drainPurge = Effect.gen(function* () {
  const database = yield* Database.Service
  const intents = yield* database
    .use("Project.purge.list", (db) =>
      db
        .select()
        .from(ProjectPurgeTable)
        .orderBy(asc(ProjectPurgeTable.timeCreated), asc(ProjectPurgeTable.id))
        .limit(batch),
    )
    .pipe(Effect.orDie)
  yield* Effect.forEach(
    intents,
    (intent) =>
      purge(intent).pipe(
        Effect.catchCause((cause) =>
          // Installer alarm signature (Q7.4): repeated lines mean purge is stuck.
          Effect.logError("Project.purge failed", {
            purgeID: intent.id,
            workspaceID: intent.workspaceID,
            ...(intent.projectID === null ? {} : { projectID: intent.projectID }),
            cause: String(cause),
          }),
        ),
      ),
    { discard: true },
  )
}).pipe(Effect.withSpan("Project.purge"))
