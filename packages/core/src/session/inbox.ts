export * as SessionInbox from "./inbox.js"

import { Admitted, Assistant, CompactionRunning, ID, Synthetic, User } from "@bymorning/schema/message"
import { Session } from "@bymorning/schema/session"
import { SessionEvent } from "@bymorning/schema/session-event"
import { SessionInbox } from "@bymorning/schema/session-inbox"
import { empty } from "@bymorning/schema/usage"
import { Workspace } from "@bymorning/schema/workspace"
import { and, asc, eq, sql } from "drizzle-orm"
import { Array, Context, Crypto, DateTime, Effect, Layer, Option, Schema } from "effect"
import { Bus } from "../bus.js"
import { Database, SessionInboxTable, SessionMessageTable, SessionTable } from "../database.js"
import { CompactionConflictError, NotFoundError, PromptConflictError, SyntheticConflictError } from "../session.js"
import { allocate } from "./position.js"

export class ConflictError extends Schema.TaggedError<ConflictError>()("SessionInbox.ConflictError", { messageID: ID }) {}
class MissingError extends Schema.TaggedError<MissingError>()("SessionInbox.MissingError", {}) {}
class StaleError extends Schema.TaggedError<StaleError>()("SessionInbox.StaleError", {}) {}

export type Delivered =
  | { readonly type: "prompt"; readonly assistant: Assistant; readonly workspaceID: Workspace.ID }
  | { readonly type: "compaction"; readonly compaction: CompactionRunning; readonly workspaceID: Workspace.ID }

export interface Interface {
  readonly admitPrompt: (input: Session.PromptInput) => Effect.Effect<SessionInbox.Info | undefined, ConflictError>
  readonly admitSynthetic: (input: Session.SyntheticInput) => Effect.Effect<SessionInbox.Info | undefined, ConflictError>
  readonly admitCompaction: (input: Session.CompactInput) => Effect.Effect<SessionInbox.Info | undefined, ConflictError>
  readonly deliver: (sessionID: Session.ID, onCommitted?: (messageID: ID) => Effect.Effect<void>) => Effect.Effect<Delivered | undefined>
  readonly list: Effect.Effect<ReadonlyArray<Session.ID>>
}
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/SessionInbox") {}

const priority = [sql`case when ${SessionInboxTable.delivery} = 'steer' then 0 else 1 end`, asc(SessionInboxTable.admittedSequence)] as const

const decodeInfo = (row: typeof SessionInboxTable.$inferSelect) =>
  Schema.decodeUnknownEffect(SessionInbox.Info)({
    id: row.id, sessionID: row.sessionID, admittedSequence: row.admittedSequence,
    type: row.type, payload: row.payload, delivery: row.delivery, createdAt: row.timeCreated.toISOString(),
  }).pipe(Effect.orDie)

const existingMessage = (row: typeof SessionMessageTable.$inferSelect) => {
  if (row.type === "user") return Schema.decodeUnknownEffect(User)(row.data).pipe(Effect.flatMap((message) => Schema.decodeUnknownEffect(SessionInbox.Info)({ id: message.id, sessionID: message.sessionID, admittedSequence: message.admittedSequence, type: "user", payload: { text: message.text, ...(message.agents === undefined ? {} : { agents: message.agents }), ...(message.metadata === undefined ? {} : { metadata: message.metadata }) }, delivery: message.delivery ?? "queue", createdAt: message.createdAt.toISOString() })), Effect.orDie)
  if (row.type === "synthetic") return Schema.decodeUnknownEffect(Synthetic)(row.data).pipe(Effect.flatMap((message) => Schema.decodeUnknownEffect(SessionInbox.Info)({ id: message.id, sessionID: message.sessionID, admittedSequence: message.sequence, type: "synthetic", payload: { text: message.text, ...(message.description === undefined ? {} : { description: message.description }), ...(message.metadata === undefined ? {} : { metadata: message.metadata }) }, delivery: "queue", createdAt: message.createdAt.toISOString() })), Effect.orDie)
  return Schema.decodeUnknownEffect(CompactionRunning)(row.data).pipe(Effect.flatMap((message) => Schema.decodeUnknownEffect(SessionInbox.Info)({ id: message.id, sessionID: message.sessionID, admittedSequence: message.sequence, type: "compaction", payload: {}, delivery: "queue", createdAt: message.createdAt.toISOString() })), Effect.orDie)
}

export const make = (workspaceID: Workspace.ID) => Effect.gen(function* () {
  const database = yield* Database.Service
  const bus = yield* Bus.Service
  const crypto = yield* Crypto.Crypto
  const suspended = new Set<ID>()

  const admit = Effect.fn("SessionInbox.admit")(function* (input: Session.PromptInput | Session.SyntheticInput | Session.CompactInput, item: SessionInbox.Item, created: Date) {
    const conflict = (messageID: ID) => {
      if (item.type === "user") return new PromptConflictError({ sessionID: input.sessionID, messageID })
      if (item.type === "synthetic") return new SyntheticConflictError({ sessionID: input.sessionID, messageID })
      return new CompactionConflictError({ sessionID: input.sessionID, messageID })
    }
    const id = input.id ?? (yield* crypto.randomUUIDv4.pipe(Effect.flatMap(Schema.decodeUnknownEffect(ID)), Effect.orDie))
    const outcome = yield* database.transactRoot(Effect.gen(function* () {
      const session = yield* database.use("sessionInboxOwner", (tx) => tx.select({ id: SessionTable.id }).from(SessionTable).where(and(eq(SessionTable.workspaceID, workspaceID), eq(SessionTable.id, input.sessionID))).for("update").pipe(Effect.map(Array.head)))
      if (Option.isNone(session)) return yield* new NotFoundError({ sessionID: input.sessionID })
      const collision = yield* database.use("sessionInboxCollision", (tx) => tx.select().from(SessionInboxTable).where(eq(SessionInboxTable.id, id)).limit(1).pipe(Effect.map(Array.head)))
      if (Option.isSome(collision)) {
        if (collision.value.sessionID !== input.sessionID || collision.value.type !== item.type) return yield* conflict(id)
        return { info: yield* decodeInfo(collision.value), fresh: false }
      }
      const message = yield* database.use("sessionInboxMessageCollision", (tx) => tx.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, id)).limit(1).pipe(Effect.map(Array.head)))
      if (Option.isSome(message)) {
        if (message.value.sessionID !== input.sessionID || message.value.type !== item.type) return yield* conflict(id)
        return { info: yield* existingMessage(message.value), fresh: false }
      }
      if (item.type === "compaction") {
        const current = yield* database.use("sessionInboxCompaction", (tx) => tx.select().from(SessionInboxTable).where(and(eq(SessionInboxTable.sessionID, input.sessionID), eq(SessionInboxTable.type, "compaction"))).limit(1).pipe(Effect.map(Array.head)))
        if (Option.isSome(current)) return { info: yield* decodeInfo(current.value), fresh: false }
      }
      const admittedSequence = yield* allocate(database, input.sessionID, 1)
      const info = yield* Schema.decodeUnknownEffect(SessionInbox.Info)({
        id,
        sessionID: input.sessionID,
        admittedSequence,
        createdAt: created.toISOString(),
        ...item,
      }).pipe(Effect.orDie)
      yield* database.use("sessionInboxInsert", (tx) => tx.insert(SessionInboxTable).values({ id, sessionID: input.sessionID, admittedSequence, type: item.type, payload: item.payload, delivery: item.delivery, timeCreated: created }))
      return { info, fresh: true }
    })).pipe(Effect.orDie)
    if (outcome.fresh && item.type === "user")
      yield* bus.publish(SessionEvent.InputAdmitted, { sessionID: input.sessionID, item: outcome.info }).pipe(Effect.orDie)
    if (outcome.fresh && item.type === "synthetic")
      yield* bus.publish(SessionEvent.SyntheticAdmitted, { sessionID: input.sessionID, item: outcome.info }).pipe(Effect.orDie)
    if (outcome.fresh && item.type === "compaction")
      yield* bus.publish(SessionEvent.CompactionRequested, { sessionID: input.sessionID, messageID: id }).pipe(Effect.orDie)
    return outcome.info
  })

  const admitPrompt = Effect.fn("SessionInbox.admitPrompt")(function* (input: Session.PromptInput) {
    const info = yield* admit(input, { type: "user", payload: SessionInbox.UserPayload.make({ text: input.text, ...(input.agents === undefined ? {} : { agents: input.agents }), ...(input.metadata === undefined ? {} : { metadata: input.metadata }) }), delivery: input.delivery ?? "steer" }, yield* DateTime.nowAsDate)
    return info
  })
  const admitSynthetic = (input: Session.SyntheticInput) => admit(input, { type: "synthetic", payload: SessionInbox.SyntheticPayload.make({ text: input.text, ...(input.description === undefined ? {} : { description: input.description }), ...(input.metadata === undefined ? {} : { metadata: input.metadata }) }), delivery: input.delivery ?? "steer" }, new Date())
  const admitCompaction = (input: Session.CompactInput) => admit(input, { type: "compaction", payload: {}, delivery: "queue" }, new Date())

  const deliver = Effect.fn("SessionInbox.deliver")(function* (sessionID: Session.ID, onCommitted?: (messageID: ID) => Effect.Effect<void>): Effect.fn.Return<Delivered | undefined> {
    const result = yield* database.transactRoot(Effect.gen(function* () {
      const session = yield* database.use("sessionInboxDeliverOwner", (tx) => tx.select().from(SessionTable).where(and(eq(SessionTable.workspaceID, workspaceID), eq(SessionTable.id, sessionID))).for("update").pipe(Effect.map(Array.head)))
      if (Option.isNone(session)) return undefined
      const item = yield* database.use("sessionInboxDeliverItem", (tx) => tx.select().from(SessionInboxTable).where(eq(SessionInboxTable.sessionID, sessionID)).orderBy(...priority).limit(1).for("update").pipe(Effect.map(Array.head)))
      if (Option.isNone(item)) return undefined
      const info = yield* decodeInfo(item.value)
      const now = yield* DateTime.nowAsDate
      const position = yield* allocate(database, sessionID, item.value.type === "compaction" ? 1 : 2)
      if (info.type === "compaction") {
        const message = yield* Schema.decodeUnknownEffect(CompactionRunning)({
          id: info.id, sessionID, sequence: position, type: "compaction", status: "running", reason: "manual", summary: "", recent: "", createdAt: now.toISOString(),
        }).pipe(Effect.orDie)
        yield* database.use("sessionInboxCompactionPromote", (tx) => Effect.all([tx.insert(SessionMessageTable).values({ id: message.id, sessionID, sequence: position, type: message.type, data: message, timeCreated: now, timeUpdated: now }), tx.delete(SessionInboxTable).where(and(eq(SessionInboxTable.id, info.id), eq(SessionInboxTable.sessionID, sessionID)))]))
        return { type: "compaction" as const, message, workspaceID: session.value.workspaceID }
      }
      const message = info.type === "user"
        ? yield* Schema.decodeUnknownEffect(User)({ id: info.id, sessionID, sequence: position, type: "user", ...info.payload, delivery: info.delivery, admittedSequence: info.admittedSequence, createdAt: info.createdAt.toISOString() }).pipe(Effect.orDie)
        : yield* Schema.decodeUnknownEffect(Synthetic)({ id: info.id, sessionID, sequence: position, type: "synthetic", ...info.payload, createdAt: info.createdAt.toISOString() }).pipe(Effect.orDie)
      const assistantID = yield* crypto.randomUUIDv4.pipe(Effect.flatMap(Schema.decodeUnknownEffect(ID)), Effect.orDie)
      const assistant = yield* Schema.decodeUnknownEffect(Assistant)({
        id: assistantID, sessionID, sequence: position + 1, type: "assistant", agent: session.value.agent, model: session.value.model, content: [], time: { created: now.toISOString() }, usage: empty, createdAt: now.toISOString(),
      }).pipe(Effect.orDie)
      yield* database.use("sessionInboxPromote", (tx) => Effect.all([tx.insert(SessionMessageTable).values([{ id: message.id, sessionID, sequence: position, type: message.type, data: message, timeCreated: info.createdAt, timeUpdated: now }, { id: assistant.id, sessionID, sequence: position + 1, type: assistant.type, data: assistant, timeCreated: now, timeUpdated: now }]), tx.delete(SessionInboxTable).where(and(eq(SessionInboxTable.id, info.id), eq(SessionInboxTable.sessionID, sessionID)))]))
      if (onCommitted !== undefined) yield* database.afterCommit(onCommitted(assistantID))
      return { type: "prompt" as const, inboxID: info.id, message, assistant, workspaceID: session.value.workspaceID }
    })).pipe(Effect.orDie)
    if (result === undefined) return undefined
    if (result.type === "compaction") {
      yield* bus.publish(SessionEvent.CompactionStarted, { sessionID, message: result.message }).pipe(Effect.orDie)
      return { type: "compaction", compaction: result.message, workspaceID: result.workspaceID }
    }
    if (result.message.type === "user")
      yield* bus.publish(SessionEvent.InputPromoted, { sessionID, inboxID: result.inboxID, message: result.message }).pipe(Effect.orDie)
    else
      yield* bus.publish(SessionEvent.SyntheticPromoted, { sessionID, inboxID: result.inboxID, message: result.message }).pipe(Effect.orDie)
    yield* bus.publish(SessionEvent.ExecutionStarted, { sessionID, message: result.assistant }).pipe(Effect.orDie)
    suspended.delete(result.inboxID)
    return { type: "prompt", assistant: result.assistant, workspaceID: result.workspaceID }
  })
  const list = database.use("sessionInboxList", (db) => db.select({ id: SessionInboxTable.id, sessionID: SessionInboxTable.sessionID }).from(SessionInboxTable).innerJoin(SessionTable, eq(SessionTable.id, SessionInboxTable.sessionID)).where(eq(SessionTable.workspaceID, workspaceID)).orderBy(asc(SessionInboxTable.sessionID), ...priority).pipe(Effect.map((rows) => [...new Set(rows.filter((row) => !suspended.has(row.id)).map((row) => row.sessionID))]), Effect.orDie))
  return Service.of({ admitPrompt, admitSynthetic, admitCompaction, deliver, list })
})

export const layer = (workspaceID: Workspace.ID) => Layer.effect(Service, make(workspaceID))

/** Compatibility for private callers that run before the Inbox service is composed. */
export const admitSynthetic = (_workspaceID: Workspace.ID, input: Session.SyntheticInput) =>
  Effect.flatMap(Service, (service) => service.admitSynthetic(input))
