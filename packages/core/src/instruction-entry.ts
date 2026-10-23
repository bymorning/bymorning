import type { GlobalNode } from "@bymorning/util/effect/app-node"
/** Exposes Workspace-bound API-managed Instruction Entries. */
export * as InstructionEntry from "./instruction-entry.js"

import { InstructionEntry } from "@bymorning/schema/instruction-entry"
import { Session } from "@bymorning/schema/session"
import { Workspace } from "@bymorning/schema/workspace"
import { makeWorkspaceNode } from "@bymorning/util/effect/app-node"
import { and, asc, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "./database.js"
import { InstructionEntryTable } from "./database/schema/instruction.sql.js"
import { SessionTable } from "./database/schema/session.sql.js"
import { Instruction } from "./instruction.js"
import { Actor } from "./actor.js"

export const Key = InstructionEntry.Key
export type Key = InstructionEntry.Key
export const Info = InstructionEntry.Info
export type Info = InstructionEntry.Info
export const MaxBytes = InstructionEntry.MaxBytes
export const SizeError = InstructionEntry.SizeError

export interface Interface {
  readonly list: (sessionID: Session.ID) => Effect.Effect<ReadonlyArray<Info>, Session.NotFoundError>
  readonly put: (input: {
    readonly sessionID: Session.ID
    readonly key: Key
    readonly value: Schema.Json
  }) => Effect.Effect<void, Session.NotFoundError | InstructionEntry.SizeError>
  readonly remove: (input: {
    readonly sessionID: Session.ID
    readonly key: Key
  }) => Effect.Effect<void, Session.NotFoundError>
  readonly load: (sessionID: Session.ID) => Effect.Effect<Instruction.List, Session.NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/core/InstructionEntry") {}

const renderValue = (value: Schema.Json) => (typeof value === "string" ? value : JSON.stringify(value, null, 2))
const renderBlock = (key: Key, value: Schema.Json) =>
  [`<context key="${key}">`, renderValue(value), "</context>"].join("\n")

const source = (entry: Info & { readonly removed: boolean }) =>
  Instruction.make<Schema.Json>({
    key: Instruction.Key.make(`api/${entry.key}`),
    codec: Schema.toCodecJson(Schema.Json),
    read: Effect.succeed(entry.removed ? Instruction.removed : entry.value),
    render: {
      initial: (value) => renderBlock(entry.key, value),
      changed: (_previous, value) =>
        [
          `The context under "${entry.key}" changed and supersedes the previous value:`,
          renderBlock(entry.key, value),
        ].join("\n"),
      removed: () => `The context under "${entry.key}" no longer applies. Disregard it.`,
    },
  })

export const layer = (workspaceID: Workspace.ID): Layer.Layer<Service, never, Database.Service> =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const database = yield* Database.Service
      const owned = Effect.fnUntraced(function* (db: Database.Executor, sessionID: Session.ID) {
        const rows = yield* db
          .select({ id: SessionTable.id })
          .from(SessionTable)
          .where(and(eq(SessionTable.workspaceID, workspaceID), eq(SessionTable.id, sessionID)))
          .limit(1)
          .pipe(Effect.orDie)
        if (rows[0] === undefined) return yield* new Session.NotFoundError({ sessionID })
        return undefined
      })
      const rows = Effect.fnUntraced(function* (sessionID: Session.ID, includeRemoved: boolean) {
        return yield* database
          .transact(
            database.use("InstructionEntry.rows", (db) =>
              Effect.gen(function* () {
                yield* owned(db, sessionID)
                return yield* db
                  .select({
                    key: InstructionEntryTable.key,
                    value: InstructionEntryTable.value,
                    removed: InstructionEntryTable.removed,
                  })
                  .from(InstructionEntryTable)
                  .where(
                    and(
                      eq(InstructionEntryTable.sessionID, sessionID),
                      includeRemoved ? undefined : eq(InstructionEntryTable.removed, false),
                    ),
                  )
                  .orderBy(asc(InstructionEntryTable.key))
                  .pipe(Effect.orDie)
              }),
            ),
          )
          .pipe(Effect.catchTag("SqlError", Effect.die))
      })
      const list = Effect.fn("InstructionEntry.list")(function* (sessionID: Session.ID) {
        return (yield* rows(sessionID, false)).map((row) => ({ key: row.key, value: row.value }))
      })
      const put = Effect.fn("InstructionEntry.put")(function* (input: {
        readonly sessionID: Session.ID
        readonly key: Key
        readonly value: Schema.Json
      }) {
        const actualBytes = Buffer.byteLength(JSON.stringify(input.value), "utf8")
        if (actualBytes > MaxBytes)
          return yield* new SizeError({
            actualBytes,
            maxBytes: MaxBytes,
            message: `Instruction entry value is ${actualBytes} bytes; the limit is ${MaxBytes} bytes`,
          })
        const changed =
          input.value === null
            ? sql`${InstructionEntryTable.value} is not null`
            : sql`${InstructionEntryTable.value} is null or ${InstructionEntryTable.value} is distinct from ${JSON.stringify(input.value)}::jsonb`
        yield* database
          .transact(
            database.use("InstructionEntry.put", (db) =>
              Effect.gen(function* () {
                yield* owned(db, input.sessionID)
                yield* db
                  .insert(InstructionEntryTable)
                  .values({ sessionID: input.sessionID, key: input.key, value: input.value, removed: false })
                  .onConflictDoUpdate({
                    target: [InstructionEntryTable.sessionID, InstructionEntryTable.key],
                    set: { value: input.value, removed: false, timeUpdated: sql`now()` },
                    setWhere: sql`${InstructionEntryTable.removed} or ${changed}`,
                  })
                  .pipe(Effect.orDie)
              }),
            ),
          )
          .pipe(Effect.catchTag("SqlError", Effect.die))
        return undefined
      })
      const remove = Effect.fn("InstructionEntry.remove")(function* (input: {
        readonly sessionID: Session.ID
        readonly key: Key
      }) {
        yield* database
          .transact(
            database.use("InstructionEntry.remove", (db) =>
              Effect.gen(function* () {
                yield* owned(db, input.sessionID)
                yield* db
                  .update(InstructionEntryTable)
                  .set({ value: null, removed: true, timeUpdated: sql`now()` })
                  .where(
                    and(
                      eq(InstructionEntryTable.sessionID, input.sessionID),
                      eq(InstructionEntryTable.key, input.key),
                      eq(InstructionEntryTable.removed, false),
                    ),
                  )
                  .pipe(Effect.orDie)
              }),
            ),
          )
          .pipe(Effect.catchTag("SqlError", Effect.die))
      })
      const load = Effect.fn("InstructionEntry.load")(function* (sessionID: Session.ID) {
        return Instruction.combine((yield* rows(sessionID, true)).map(source))
      })
      return Service.of({ list, put, remove, load })
    }),
  )

export const workspaceNodes = <E>(workspaceID: Workspace.ID, database?: GlobalNode<Database.Service, E>) =>
  makeWorkspaceNode({ service: Service, layer: layer(workspaceID), deps: [database ?? Database.node] })

export const node = makeWorkspaceNode({
  service: Service,
  layer: Layer.unwrap(Effect.map(Actor.Binding.Service, ({ workspaceID }) => layer(workspaceID))),
  deps: [Actor.binding, Database.node],
})
