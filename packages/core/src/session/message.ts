export * as SessionMessage from "./message.js"

import { Assistant, ID, Message } from "@bymorning/schema/message"
import { Session } from "@bymorning/schema/session"
import { SessionError } from "@bymorning/schema/session-error"
import { SessionEvent } from "@bymorning/schema/session-event"
import { empty } from "@bymorning/schema/usage"
import { Workspace } from "@bymorning/schema/workspace"
import { and, asc, eq, isNull } from "drizzle-orm"
import { Array, Crypto, DateTime, Effect, Option, Schema } from "effect"
import { type Database, SessionMessageTable, SessionTable } from "../database.js"
import type { Bus } from "../bus.js"
import { allocate } from "./position.js"

/** Replace a retained assistant before publishing an event that describes it. */
export const updateAssistant = (
  database: Database.Interface,
  workspaceID: Workspace.ID,
  messageID: ID,
  transform: (message: Assistant, now: Date) => Assistant,
) =>
  database
    .transact(
      database.use("sessionMessageUpdate", (tx) =>
        Effect.gen(function* () {
          const row = yield* tx
            .select({ data: SessionMessageTable.data })
            .from(SessionMessageTable)
            .innerJoin(SessionTable, eq(SessionTable.id, SessionMessageTable.sessionID))
            .where(
              and(
                eq(SessionTable.workspaceID, workspaceID),
                eq(SessionMessageTable.id, messageID),
                eq(SessionMessageTable.type, "assistant"),
              ),
            )
            .for("update")
            .pipe(Effect.map(Array.head))
          if (Option.isNone(row)) return yield* Effect.die(new Error("Assistant Message missing while updating"))
          const current = yield* Schema.decodeUnknownEffect(Assistant)(row.value.data)
          const now = yield* DateTime.nowAsDate
          const message = transform(current, now)
          yield* tx
            .update(SessionMessageTable)
            .set({ data: message, timeUpdated: now })
            .where(eq(SessionMessageTable.id, messageID))
          return message
        }),
      ),
    )
    .pipe(Effect.orDie)

export const transcript = (database: Database.Interface, workspaceID: Workspace.ID, sessionID: Session.ID) =>
  database.use("sessionMessageContext", (executor) =>
    executor
      .select({ data: SessionMessageTable.data })
      .from(SessionMessageTable)
      .innerJoin(SessionTable, eq(SessionTable.id, SessionMessageTable.sessionID))
      .where(and(eq(SessionTable.workspaceID, workspaceID), eq(SessionMessageTable.sessionID, sessionID)))
      .orderBy(asc(SessionMessageTable.sequence))
      .pipe(
        Effect.orDie,
        Effect.flatMap((rows) =>
          Effect.forEach(rows, (row) => Schema.decodeUnknownEffect(Message)(row.data).pipe(Effect.orDie)),
        ),
      ),
  )

export const context = (database: Database.Interface, workspaceID: Workspace.ID, sessionID: Session.ID) =>
  transcript(database, workspaceID, sessionID).pipe(
    Effect.map((messages) => {
      const boundary = messages.findLastIndex(
        (message) => message.type === "compaction" && message.status === "completed",
      )
      return boundary < 0 ? messages : messages.slice(boundary)
    }),
  )

export const continues = (message: Message) =>
  message.type === "assistant" &&
  message.time.completed !== undefined &&
  message.error === undefined &&
  ((message.finish === "unknown" && !message.content.some((part) => part.type === "text" && part.text.length > 0)) ||
    message.content.some(
      (part) =>
        part.type === "tool" &&
        part.providerExecuted !== true &&
        (part.state.status === "completed" || part.state.status === "error"),
    ))

export const needsContinuation = (database: Database.Interface, workspaceID: Workspace.ID, sessionID: Session.ID) =>
  context(database, workspaceID, sessionID).pipe(
    // Durable instruction updates are chronological `system` messages, not conversational turns.
    // Skip them so a trailing update projected before a step does not end tool-call continuation.
    // Only `system` updates are transparent here; `synthetic` messages arrive as inbox input.
    Effect.map((messages) => messages.findLast((message) => message.type !== "system")),
    Effect.map((message) => message !== undefined && continues(message)),
  )

export const continuations = (database: Database.Interface, workspaceID: Workspace.ID) =>
  database.use("sessionMessageContinuations", (executor) =>
    executor
      .select({ data: SessionMessageTable.data })
      .from(SessionMessageTable)
      .innerJoin(SessionTable, eq(SessionTable.id, SessionMessageTable.sessionID))
      .where(eq(SessionTable.workspaceID, workspaceID))
      .orderBy(asc(SessionMessageTable.sessionID), asc(SessionMessageTable.sequence))
      .pipe(
        Effect.orDie,
        Effect.flatMap((rows) =>
          Effect.forEach(rows, (row) => Schema.decodeUnknownEffect(Message)(row.data).pipe(Effect.orDie)),
        ),
        Effect.map((messages) => {
          const latest = new Map<Session.ID, Message>()
          // A trailing durable instruction `system` update must not mask an assistant awaiting
          // continuation, or restart recovery would drop the interrupted tool step.
          for (const message of messages) {
            if (message.type === "system") continue
            latest.set(message.sessionID, message)
          }
          return [...latest].filter(([, message]) => continues(message)).map(([sessionID]) => sessionID)
        }),
      ),
  )

export const continueExecution = Effect.fn("Session.Message.continue")(function* (
  database: Database.Interface,
  events: Bus.Interface,
  crypto: Crypto.Crypto,
  workspaceID: Workspace.ID,
  sessionID: Session.ID,
  onCommitted?: (messageID: ID) => Effect.Effect<void>,
) {
  while (true) {
    const row = yield* database
      .use("sessionContinueSnapshot", (tx) =>
        tx
          .select()
          .from(SessionTable)
          .where(and(eq(SessionTable.workspaceID, workspaceID), eq(SessionTable.id, sessionID)))
          .limit(1)
          .pipe(Effect.map(Array.head)),
      )
      .pipe(Effect.orDie)
    if (Option.isNone(row)) return yield* Effect.die(new Error("Continuation requires an existing Session"))
    if (!(yield* needsContinuation(database, workspaceID, sessionID))) return undefined
    const assistantID = yield* crypto.randomUUIDv4.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(ID)),
      Effect.provideService(Crypto.Crypto, crypto),
      Effect.orDie,
    )
    const created = yield* DateTime.nowAsDate
    const result = yield* database
      .transact(
        database.use("sessionContinue", (tx) =>
          Effect.gen(function* () {
            const locked = yield* tx
              .select()
              .from(SessionTable)
              .where(and(eq(SessionTable.workspaceID, workspaceID), eq(SessionTable.id, sessionID)))
              .for("update")
              .pipe(Effect.map(Array.head))
            if (
              Option.isNone(locked) ||
              locked.value.agent !== row.value.agent ||
              JSON.stringify(locked.value.model) !== JSON.stringify(row.value.model) ||
              !(yield* needsContinuation(database, workspaceID, sessionID))
            )
              return yield* new StaleError()
            const sequence = yield* allocate(database, sessionID, 1)
            const assistant = Assistant.make({
              id: assistantID,
              sessionID,
              sequence,
              type: "assistant",
              agent: locked.value.agent,
              model: locked.value.model,
              content: [],
              time: { created },
              usage: empty,
              createdAt: created,
            })
            yield* tx.insert(SessionMessageTable).values({
              id: assistant.id,
              sessionID,
              sequence,
              type: assistant.type,
              data: assistant,
              timeCreated: created,
              timeUpdated: created,
            })
            return assistant
          }),
        ),
      )
      .pipe(Effect.result)
    if (result._tag === "Failure") {
      if (result.failure._tag === "SessionMessage.StaleError") continue
      return yield* Effect.die(result.failure)
    }
    const assistant = result.success
    if (onCommitted !== undefined) yield* onCommitted(assistantID)
    yield* events.publish(SessionEvent.ExecutionStarted, { sessionID, message: assistant }).pipe(Effect.orDie)
    return {
      assistant,
      workspaceID: row.value.workspaceID,
    }
  }
})

/** Start a fresh physical attempt without promoting another User Message. */
export const restartExecution = Effect.fn("Session.Message.restart")(function* (
  database: Database.Interface,
  events: Bus.Interface,
  crypto: Crypto.Crypto,
  workspaceID: Workspace.ID,
  assistant: Assistant,
) {
  const id = yield* crypto.randomUUIDv4.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(ID)),
    Effect.provideService(Crypto.Crypto, crypto),
  )
  const created = yield* DateTime.nowAsDate
  const restarted = yield* database
    .transact(
      database.use("sessionRestart", (tx) =>
        Effect.gen(function* () {
          const owner = yield* tx
            .select({ id: SessionTable.id })
            .from(SessionTable)
            .where(and(eq(SessionTable.id, assistant.sessionID), eq(SessionTable.workspaceID, workspaceID)))
            .for("update")
            .pipe(Effect.map(Array.head))
          if (Option.isNone(owner)) return yield* Effect.die(new Error("Restart requires an owned Session"))
          const sequence = yield* allocate(database, assistant.sessionID, 1)
          const message = Assistant.make({
            ...assistant,
            id,
            sequence,
            content: [],
            time: { created },
            usage: empty,
            createdAt: created,
          })
          yield* tx.insert(SessionMessageTable).values({
            id,
            sessionID: message.sessionID,
            sequence,
            type: message.type,
            data: message,
            timeCreated: created,
            timeUpdated: created,
          })
          return message
        }),
      ),
    )
    .pipe(Effect.orDie)
  yield* events
    .publish(SessionEvent.ExecutionStarted, { sessionID: assistant.sessionID, message: restarted })
    .pipe(Effect.orDie)
  return restarted
}, Effect.orDie)
class StaleError extends Schema.TaggedError<StaleError>()("SessionMessage.StaleError", {}) {}
class SettledError extends Schema.TaggedError<SettledError>()("SessionMessage.SettledError", {}) {}

export const complete = Effect.fn("Session.Message.complete")(function* (
  database: Database.Interface,
  events: Bus.Interface,
  workspaceID: Workspace.ID,
  sessionID: Session.ID,
  messageID: ID,
  finish: Assistant["finish"],
) {
  const message = yield* database
    .transact(
      database.use("sessionComplete", (tx) =>
        Effect.gen(function* () {
          const row = yield* tx
            .select({ data: SessionMessageTable.data })
            .from(SessionMessageTable)
            .innerJoin(SessionTable, eq(SessionTable.id, SessionMessageTable.sessionID))
            .where(
              and(
                eq(SessionTable.workspaceID, workspaceID),
                eq(SessionMessageTable.sessionID, sessionID),
                eq(SessionMessageTable.id, messageID),
              ),
            )
            .for("update")
            .pipe(Effect.map(Array.head))
          if (Option.isNone(row)) return yield* Effect.die(new Error("Assistant Message missing while completing"))
          const current = yield* Schema.decodeUnknownEffect(Assistant)(row.value.data)
          const now = yield* DateTime.nowAsDate
          const message = Assistant.make({
            ...current,
            finish: finish ?? "unknown",
            time: { ...current.time, completed: now },
          })
          yield* tx
            .update(SessionMessageTable)
            .set({ data: message, timeUpdated: now })
            .where(eq(SessionMessageTable.id, messageID))
          yield* tx
            .update(SessionTable)
            .set({ timeUpdated: now })
            .where(and(eq(SessionTable.id, sessionID), eq(SessionTable.workspaceID, workspaceID)))
          return message
        }),
      ),
    )
    .pipe(Effect.orDie)
  return yield* events
    .publish(SessionEvent.Succeeded, { sessionID, message, finish: finish ?? "unknown" })
    .pipe(Effect.orDie)
})

export const interrupt = Effect.fn("SessionMessage.interrupt")(function* (
  database: Database.Interface,
  events: Bus.Interface,
  workspaceID: Workspace.ID,
  messageID: ID,
) {
  const row = yield* database.use("sessionInterruptSnapshot", (tx) =>
    tx
      .select({ data: SessionMessageTable.data, sessionID: SessionMessageTable.sessionID })
      .from(SessionMessageTable)
      .innerJoin(SessionTable, eq(SessionTable.id, SessionMessageTable.sessionID))
      .where(
        and(
          eq(SessionTable.workspaceID, workspaceID),
          eq(SessionMessageTable.id, messageID),
          eq(SessionMessageTable.type, "assistant"),
        ),
      )
      .limit(1)
      .pipe(Effect.map(Array.head)),
  )
  if (Option.isNone(row)) return false
  const message = yield* Schema.decodeUnknownEffect(Assistant)(row.value.data)
  if (message.sessionID !== row.value.sessionID) return false
  if (message.time.completed !== undefined) return false
  const error = SessionError.Aborted.make({ message: "Execution interrupted" })
  const toolEvents = message.content.flatMap((part) =>
    part.type !== "tool" || (part.state.status !== "streaming" && part.state.status !== "running")
      ? []
      : [
          [
            SessionEvent.ToolFailed,
            {
              sessionID: message.sessionID,
              messageID,
              callID: part.id,
              name: part.name,
              input: part.state.status === "running" ? part.state.input : {},
              error,
              ...(part.providerExecuted === undefined ? {} : { providerExecuted: part.providerExecuted }),
              ...(part.providerMetadata === undefined ? {} : { providerMetadata: part.providerMetadata }),
            },
          ] as const,
        ],
  )
  const settled = yield* database
    .transact(
      database.use("sessionInterruptLock", (tx) =>
        Effect.gen(function* () {
          const current = yield* tx
            .select({ data: SessionMessageTable.data, sessionID: SessionMessageTable.sessionID })
            .from(SessionMessageTable)
            .innerJoin(SessionTable, eq(SessionTable.id, SessionMessageTable.sessionID))
            .where(
              and(
                eq(SessionTable.workspaceID, workspaceID),
                eq(SessionMessageTable.id, messageID),
                eq(SessionMessageTable.type, "assistant"),
              ),
            )
            .for("update")
            .pipe(Effect.map(Array.head))
          if (Option.isNone(current)) return yield* new SettledError()
          const locked = yield* Schema.decodeUnknownEffect(Assistant)(current.value.data)
          if (locked.sessionID !== current.value.sessionID) return yield* new SettledError()
          if (locked.time.completed !== undefined) return yield* new SettledError()
          const now = yield* DateTime.nowAsDate
          const completed = Assistant.make({
            ...locked,
            content: locked.content.map((part) =>
              part.type !== "tool" || (part.state.status !== "streaming" && part.state.status !== "running")
                ? part
                : {
                    ...part,
                    state: {
                      status: "error" as const,
                      input: part.state.status === "running" ? part.state.input : {},
                      error,
                    },
                    time: { ...part.time, completed: now },
                  },
            ),
            error,
            time: { ...locked.time, completed: now },
          })
          yield* tx
            .update(SessionMessageTable)
            .set({ data: completed, timeUpdated: now })
            .where(eq(SessionMessageTable.id, messageID))
          yield* tx
            .update(SessionTable)
            .set({ timeUpdated: now })
            .where(and(eq(SessionTable.id, completed.sessionID), eq(SessionTable.workspaceID, workspaceID)))
          return completed
        }),
      ),
    )
    .pipe(Effect.result)
  if (settled._tag === "Failure") {
    if (Schema.is(SettledError)(settled.failure)) return false
    return yield* Effect.die(settled.failure)
  }
  // The full group is committed before its first notification.
  for (const [definition, data] of toolEvents) yield* events.publish(definition, data).pipe(Effect.orDie)
  yield* events
    .publish(SessionEvent.Interrupted, { sessionID: message.sessionID, message: settled.success, error })
    .pipe(Effect.orDie)
  return true
}, Effect.orDie)

export const interruptStale = Effect.fn("SessionMessage.interruptStale")(function* (
  database: Database.Interface,
  events: Bus.Interface,
  workspaceID: Workspace.ID,
) {
  const interrupted = new Set<Session.ID>()
  const rows = yield* database
    .use("sessionMessageStale", (executor) =>
      executor
        .select({ data: SessionMessageTable.data })
        .from(SessionMessageTable)
        .innerJoin(SessionTable, eq(SessionTable.id, SessionMessageTable.sessionID))
        .where(
          and(
            eq(SessionTable.workspaceID, workspaceID),
            isNull(SessionTable.parentID),
            eq(SessionMessageTable.type, "assistant"),
          ),
        )
        .orderBy(asc(SessionMessageTable.sessionID), asc(SessionMessageTable.sequence)),
    )
    .pipe(Effect.orDie)
  for (const row of rows) {
    const message = yield* Schema.decodeUnknownEffect(Message)(row.data).pipe(Effect.orDie)
    if (
      message.type === "assistant" &&
      message.time.completed === undefined &&
      (yield* interrupt(database, events, workspaceID, message.id))
    )
      interrupted.add(message.sessionID)
  }
  return interrupted
})
