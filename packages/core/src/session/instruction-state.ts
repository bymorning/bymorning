export * as InstructionState from "./instruction-state.js"

import { InstructionSchema } from "@bymorning/schema/instruction"
import { System } from "@bymorning/schema/message"
import type { Session } from "@bymorning/schema/session"
import { SessionEvent } from "@bymorning/schema/session-event"
import { and, eq, inArray, lt, sql } from "drizzle-orm"
import { Cause, Crypto, DateTime, Effect, Option, Schema } from "effect"
import type { Bus } from "../bus.js"
import type { Database } from "../database.js"
import { InstructionBlobTable } from "../database/schema/instruction.sql.js"
import { InstructionTable, SessionMessageTable, SessionTable } from "../database/schema/session.sql.js"
import { Instruction } from "../instruction.js"
import { allocate } from "./position.js"

interface Observation extends Instruction.Admission {
  readonly initial: boolean
  readonly previous: InstructionSchema.Values
}

const Stored = Schema.Struct({
  throughSequence: Schema.Int.check(Schema.isGreaterThan(0)),
  initialValues: InstructionSchema.Values,
  currentValues: InstructionSchema.Values,
})

const Blob = Schema.Struct({ hash: InstructionSchema.Hash, value: Schema.Json })
const absent = Symbol("Session.InstructionState.absent")
type Revision = number | typeof absent

const find = (db: Database.Executor, sessionID: Session.ID) =>
  db
    .select({
      throughSequence: InstructionTable.throughSequence,
      initialValues: InstructionTable.initialValues,
      currentValues: InstructionTable.currentValues,
    })
    .from(InstructionTable)
    .where(eq(InstructionTable.sessionID, sessionID))
    .limit(1)
    .pipe(
      Effect.flatMap((rows) => {
        const row = rows[0]
        return row === undefined
          ? Effect.as(Effect.void, undefined)
          : Schema.decodeUnknownEffect(Stored)(row).pipe(Effect.orDie)
      }),
    )

const revision = (db: Database.Executor, sessionID: Session.ID) =>
  db
    .select({ throughSequence: InstructionTable.throughSequence })
    .from(InstructionTable)
    .where(eq(InstructionTable.sessionID, sessionID))
    .limit(1)
    .pipe(Effect.map(([row]): Revision => row?.throughSequence ?? absent))

const observe = Effect.fn("Session.InstructionState.observe")(function* (
  values: Instruction.ReadResult,
  stored: Schema.Schema.Type<typeof Stored> | undefined,
) {
  const crypto = yield* Crypto.Crypto
  const previous = stored?.currentValues
  return {
    initial: stored === undefined,
    previous: previous ?? {},
    ...(yield* Instruction.diff(values, previous)),
  } satisfies Observation
})

const loadBlobs = Effect.fn("Session.InstructionState.blobs")(function* (
  db: Database.Executor,
  hashes: ReadonlyArray<InstructionSchema.Hash>,
) {
  const unique = [...new Set(hashes)]
  if (unique.length === 0) return new Map<InstructionSchema.Hash, Schema.Json>()
  const rows = yield* db.select().from(InstructionBlobTable).where(inArray(InstructionBlobTable.hash, unique))
  const decoded = yield* Effect.forEach(rows, (row) => Schema.decodeUnknownEffect(Blob)(row).pipe(Effect.orDie))
  const values = new Map(decoded.map((row) => [row.hash, row.value]))
  for (const value of unique)
    if (!values.has(value)) return yield* Effect.die(new Error(`Instruction blob missing: ${value}`))
  return values
})

const requireBlob = (blobs: ReadonlyMap<InstructionSchema.Hash, Schema.Json>, hash: InstructionSchema.Hash) => {
  const value = blobs.get(hash)
  if (value === undefined) throw new Error(`Instruction blob missing: ${hash}`)
  return value
}

const renderUpdateText = Effect.fn("Session.InstructionState.render")(function* (
  db: Database.Executor,
  sources: Instruction.List,
  observation: Observation,
) {
  const replaced = Object.entries(observation.previous).filter(([key]) => Object.hasOwn(observation.delta, key))
  const stored = yield* loadBlobs(
    db,
    replaced.map(([, value]) => value),
  )
  const admitted = new Map<Instruction.Hash, Schema.Json>(
    Object.entries(observation.blobs).map(([key, value]) => [InstructionSchema.Hash.make(key), value]),
  )
  const previous = Object.fromEntries(replaced.map(([key, value]) => [key, requireBlob(stored, value)]))
  const delta = Object.fromEntries(
    Object.entries(observation.delta).map(([key, value]) => [
      key,
      value === InstructionSchema.removed ? Option.none() : Option.some(requireBlob(admitted, value)),
    ]),
  )
  return Instruction.renderUpdate(sources, previous, delta)
})

/** Observe and durably synchronize current sources before provider assembly. */
export const prepare = Effect.fn("Session.InstructionState.prepare")(function* (
  database: Database.Interface,
  events: Bus.Interface,
  sources: Instruction.List,
  sessionID: Session.ID,
) {
  while (true) {
    const before = yield* database.use("instructionStateRevision", (db) => revision(db, sessionID)).pipe(Effect.orDie)
    // Sources may perform arbitrary external work, so capture them before taking the database lock.
    const values = yield* Instruction.read(sources)
    const stored = yield* database.use("instructionStateSnapshot", (db) => find(db, sessionID)).pipe(Effect.orDie)
    if ((stored?.throughSequence ?? absent) !== before) {
      yield* Effect.yieldNow
      continue
    }
    const observation = yield* observe(values, stored)
    if (!observation.initial && Object.keys(observation.delta).length === 0) return
    const text = observation.initial
      ? ""
      : yield* database
          .use("instructionStateRender", (db) => renderUpdateText(db, sources, observation))
          .pipe(Effect.orDie)
    const synchronized = yield* database.transactRoot(Effect.gen(function* () {
      // The Session row is the durable per-Session synchronization anchor. In
      // particular, an absent Instruction row has no row lock of its own: lock
      // the owner before deciding whether this observation is initial.
      yield* database.use("instructionStateSessionLock", (tx) =>
        tx.select({ id: SessionTable.id }).from(SessionTable).where(eq(SessionTable.id, sessionID)).for("update"),
      )
      if ((yield* database.use("instructionStateRevisionLocked", (tx) => revision(tx, sessionID))) !== before)
        return false
      const rows = Object.entries(observation.blobs).map(([value, json]) => ({ hash: InstructionSchema.Hash.make(value), value: json }))
      if (rows.length > 0)
        yield* database.use("instructionStateBlobs", (tx) => tx.insert(InstructionBlobTable).values(rows).onConflictDoNothing().pipe(Effect.asVoid))
      const sequence = yield* allocate(database, sessionID, 1)
      yield* database.use("instructionStateApply", (tx) => apply(tx, sessionID, sequence, observation.delta))
      const now = yield* DateTime.nowAsDate
      const system = text.length === 0 ? undefined : System.make({
        id: yield* Schema.decodeUnknownEffect(System.fields.id)(crypto.randomUUID()).pipe(Effect.orDie),
        sessionID, sequence, type: "system", text, createdAt: now,
      })
      if (system !== undefined)
        yield* database.use("instructionStateMessage", (tx) =>
          tx.insert(SessionMessageTable).values({ id: system.id, sessionID, sequence, type: system.type, data: system, timeCreated: now, timeUpdated: now }),
        )
      return { sequence, system }
    }).pipe(Effect.orDie, Effect.map(Option.some), Effect.catch(() => Effect.succeed(Option.none()))))
    if (Option.isSome(synchronized) && synchronized.value !== false)
      yield* events.publish(SessionEvent.InstructionUpdated, { sessionID, delta: observation.delta, ...(synchronized.value.system === undefined ? {} : { system: synchronized.value.system }) }).pipe(Effect.orDie)
    if (Option.isSome(synchronized) && synchronized.value !== false) return
    yield* Effect.yieldNow
  }
})

class StaleRevisionError extends Schema.TaggedError<StaleRevisionError>()(
  "Session.InstructionState.StaleRevisionError",
  {},
) {}

/** Apply one durable delta in its Bus projection transaction. */
export const apply = Effect.fn("Session.InstructionState.apply")(function* (
  tx: Database.Executor,
  sessionID: Session.ID,
  sequence: number,
  delta: InstructionSchema.Delta,
) {
  const stored = yield* find(tx, sessionID)
  const current = Instruction.applyHashDelta(stored?.currentValues ?? {}, delta)
  if (stored === undefined) {
    yield* tx
      .insert(InstructionTable)
      .values({ sessionID, throughSequence: sequence, initialValues: current, currentValues: current })
    return
  }
  const updated = yield* tx
    .update(InstructionTable)
    .set({ throughSequence: sequence, currentValues: current })
    .where(and(eq(InstructionTable.sessionID, sessionID), lt(InstructionTable.throughSequence, sequence)))
    .returning({ sessionID: InstructionTable.sessionID })
  if (updated.length === 1) return
  // oxlint-disable-next-line typescript-eslint/consistent-return -- return yield* preserves the never-success exit.
  return yield* Effect.die(new Error(`Instruction state sequence did not advance: ${sessionID}`))
})

/** Re-anchor the provider baseline at a completed compaction boundary. */
export const anchor = Effect.fn("Session.InstructionState.anchor")(function* (
  tx: Database.Executor,
  sessionID: Session.ID,
  sequence: number,
) {
  yield* tx
    .update(InstructionTable)
    .set({ throughSequence: sequence, initialValues: sql`${InstructionTable.currentValues}` })
    .where(and(eq(InstructionTable.sessionID, sessionID), lt(InstructionTable.throughSequence, sequence)))
})

/** Render the Session's persisted initial source baseline. */
export const initial = Effect.fn("Session.InstructionState.initial")(function* (
  database: Database.Interface,
  sessionID: Session.ID,
  sources: Instruction.List,
) {
  const stored = yield* database.use("instructionStateFind", (db) => find(db, sessionID)).pipe(Effect.orDie)
  if (stored === undefined) return yield* Effect.die(new Error(`Instruction state missing: ${sessionID}`))
  const blobs = yield* database
    .use("instructionBlobList", (db) => loadBlobs(db, Object.values(stored.initialValues)))
    .pipe(Effect.orDie)
  return Instruction.renderInitial(
    sources,
    Object.fromEntries(Object.entries(stored.initialValues).map(([key, value]) => [key, requireBlob(blobs, value)])),
  )
})

/**
 * Approximate the Session's persisted initial baseline from its stored blobs, before sources are
 * loaded. The rendered provider text exists only at provider time, which is too late for Routing;
 * an unreadable baseline estimates as empty rather than failing the turn.
 */
export const estimate = (database: Database.Interface, sessionID: Session.ID): Effect.Effect<string> =>
  Effect.gen(function* () {
    const stored = yield* database.use("instructionStateFind", (db) => find(db, sessionID)).pipe(Effect.orDie)
    if (stored === undefined) return ""
    const blobs = yield* database
      .use("instructionBlobList", (db) => loadBlobs(db, Object.values(stored.initialValues)))
      .pipe(Effect.orDie)
    return Object.values(stored.initialValues)
      .map((hash) => {
        const value = requireBlob(blobs, hash)
        return typeof value === "string" ? value : JSON.stringify(value)
      })
      .join("\n")
  }).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause)
        ? Effect.failCause(cause)
        : Effect.logWarning("Instruction baseline estimate failed; routing without it", { cause }).pipe(Effect.as("")),
    ),
  )
