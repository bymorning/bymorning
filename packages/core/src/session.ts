/** Exposes the Session contract owned by this module. */
export * as Session from "./session.js"

import {
  Admitted,
  AgentSwitched,
  ID,
  ListInput,
  Message,
  ModelSwitched,
} from "@bymorning/schema/message"
import { Session } from "@bymorning/schema/session"
import { SessionEvent } from "@bymorning/schema/session-event"
import { SessionInbox } from "@bymorning/schema/session-inbox"
import type { Info as InboxInfo, Synthetic as InboxSynthetic } from "@bymorning/schema/session-inbox"
import { Usage } from "@bymorning/schema/usage"
import { Workspace } from "@bymorning/schema/workspace"
import { User } from "@bymorning/schema/user"
import { Account } from "@bymorning/schema/account"
import { and, asc, desc, eq, gt, ilike, isNotNull, isNull, lt, notExists, or, sql } from "drizzle-orm"
import { Array, Crypto, DateTime, Effect, Layer, Option, Schema } from "effect"
import { Agent } from "./agent.js"
import { Actor } from "./actor.js"
import { Audit } from "./audit.js"
import { Bus } from "./bus.js"
import { Catalog } from "./catalog.js"
import { Database, ProjectTable, SessionInboxTable, SessionMessageTable, SessionTable } from "./database.js"
import { Project } from "./project.js"
import { Coordinator } from "./session/coordinator.js"
import { Runner } from "./session/runner.js"
import { SessionExecution } from "./session/execution.js"
import { SessionMessage } from "./session/message.js"
import { SessionPermission } from "./session/permission.js"
import { allocate } from "./session/position.js"
import { Service } from "./session/service.js"
import { SessionGraph } from "./session/graph.js"

/** Whether a completed Assistant Message requires another execution turn. */
export const continues = SessionMessage.continues

/** The requested Session does not exist. */
export const NotFoundError = Session.NotFoundError
/** The requested Session does not exist. */
export type NotFoundError = Session.NotFoundError
/** A durable Session execution stopped after recording its terminal failure. */
export const RunError = Runner.RunError
/** A durable Session execution stopped after recording its terminal failure. */
export type RunError = Runner.RunError

/** Prompt admission conflicts with an existing Message identity. */
export class PromptConflictError extends Schema.TaggedError<PromptConflictError>()("Session.PromptConflictError", {
  sessionID: Session.ID,
  messageID: Schema.String.check(Schema.isUUID()).pipe(Schema.brand("Message.ID")),
}) {}

/** Synthetic admission conflicts with an existing Message identity. */
export class SyntheticConflictError extends Schema.TaggedError<SyntheticConflictError>()(
  "Session.SyntheticConflictError",
  { sessionID: Session.ID, messageID: ID },
) {}

/** A compaction admission conflicts with an existing Message identity. */
export class CompactionConflictError extends Schema.TaggedError<CompactionConflictError>()(
  "Session.CompactionConflictError",
  { sessionID: Session.ID, messageID: ID },
) {}

/** A pagination cursor is malformed or belongs to another query. */
export class InvalidCursorError extends Schema.TaggedError<InvalidCursorError>()("Session.InvalidCursorError", {}) {}
class SelectionMissingError extends Schema.TaggedError<SelectionMissingError>()("Session.SelectionMissingError", {}) {}
class ModelSameError extends Schema.TaggedError<ModelSameError>()("Session.ModelSameError", {}) {}

/** Durable Session lifecycle, transcript, prompt, cancellation, and event operations. */
export interface Interface {
  /**
   * Create a Session in the bound Workspace. Core callers may supply a title and the Scheduled Task that started it.
   * Fails with `Project.ArchivedError` when the Project is archived.
   */
  readonly create: (
    input: Session.CreateInput & CreateExtra,
  ) => Effect.Effect<Session.Info, Project.NotFoundError | Project.ArchivedError>
  /** Create a child Session that inherits its parent's Project in the bound Workspace. */
  readonly createChild: (input: ChildCreateInput) => Effect.Effect<Session.Info, NotFoundError>
  /** Update Session summary metadata. */
  readonly update: (input: Session.UpdateInput) => Effect.Effect<Session.Info, NotFoundError | Project.NotFoundError>
  /** Delete a Session. */
  readonly delete: (sessionID: Session.ID) => Effect.Effect<void, NotFoundError>
  /**
   * List Sessions, failing with `InvalidCursorError` for an invalid cursor. Unless `archived: true` is requested,
   * Sessions in archived Projects are excluded.
   */
  readonly list: (input?: Session.ListInput) => Effect.Effect<Session.Page, InvalidCursorError>
  /** Get a Session or fail with `NotFoundError`. */
  readonly get: (sessionID: Session.ID) => Effect.Effect<Session.Detail, NotFoundError>
  /** Read current saved Messages from a domain cursor. */
  readonly messages: (input: ListInput) => Effect.Effect<ReadonlyArray<Message>, NotFoundError>
  /** Read current durable, not-yet-delivered Inbox items. */
  readonly inbox: (sessionID: Session.ID) => Effect.Effect<ReadonlyArray<InboxInfo>, NotFoundError>
  /**
   * Admit a prompt or fail when its Session is missing, its Project is archived, or Message identity conflicts.
   */
  readonly prompt: (
    input: Session.PromptInput,
  ) => Effect.Effect<Admitted, NotFoundError | PromptConflictError | Project.ArchivedError>
  /** Admit synthetic context or fail when its Session is missing or Message identity conflicts. */
  readonly synthetic: (
    input: Session.SyntheticInput,
  ) => Effect.Effect<InboxSynthetic, NotFoundError | SyntheticConflictError>
  /** Admit a manual compaction request. */
  readonly compact: (input: Session.CompactInput) => Effect.Effect<Admitted, NotFoundError | CompactionConflictError>
  /** Snapshot process-local Coordinator ownership. */
  readonly active: Effect.Effect<ReadonlySet<Session.ID>>
  /** Interrupt active Session execution or fail with `NotFoundError`. */
  readonly interrupt: (sessionID: Session.ID, reason: Coordinator.InterruptReason) => Effect.Effect<void, NotFoundError>
  /** Start or join Session execution and await its actual settlement. */
  readonly resume: (sessionID: Session.ID) => Effect.Effect<void, NotFoundError | Runner.RunError>
  /** Await process-local Session execution settlement without starting work. */
  readonly awaitIdle: (sessionID: Session.ID) => Effect.Effect<void, NotFoundError>
  /** Move active backgroundable work blocking this Session into background observation. */
  readonly background: (sessionID: Session.ID) => Effect.Effect<void, NotFoundError>
  /** Select the Agent for subsequent execution or fail with `NotFoundError`. */
  readonly switchAgent: (input: Session.AgentInput) => Effect.Effect<void, NotFoundError>
  /** Select the Model for subsequent execution or fail with `NotFoundError`. */
  readonly switchModel: (input: Session.ModelInput) => Effect.Effect<void, NotFoundError>
}

/** Handler-facing durable Session authority. */
export { Service } from "./session/service.js"

/** Core-only creation extras never accepted from the public API. */
export interface CreateExtra {
  readonly title?: Session.Title
  readonly scheduledTaskID?: Session.Info["scheduledTaskID"]
}

/** Core-only child creation input. Child Sessions cannot select their own Project. */
export interface ChildCreateInput {
  readonly parentID: Session.ID
  readonly title?: Session.Title
  readonly agent?: Session.Info["agent"]
  readonly model?: Session.Info["model"]
}

const ListCursor = Schema.Struct({
  version: Schema.Literal(2),
  kind: Schema.Literal("session"),
  updatedAt: Schema.DateFromString,
  id: Session.ID,
  search: Schema.optionalKey(Schema.String),
  parentID: Schema.optionalKey(Schema.NullOr(Session.ID)),
  archived: Schema.optionalKey(Schema.Boolean),
})
/** Public Session service assembled from its private subsystems. */
export interface Owner {
  readonly userID: User.ID
  readonly accountID: Account.ID
  readonly role: User.Role
}

/** Member-bound Session implementation. Identity is acquired with the retained member graph. */
export const memberLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const binding = yield* Actor.Binding.Service
    const workspaceID = binding.workspaceID
    const owner = binding
    const agents = yield* Agent.Service
    const database = yield* Database.Service
    const audit = yield* Audit.Service
    const bus = yield* Bus.Service
    const crypto = yield* Crypto.Crypto
    const catalog = yield* Catalog.Service
    const execution = yield* SessionExecution.Service

    const createSession = Effect.fn("Session.createSession")(function* (
      input: Session.CreateInput & CreateExtra & { readonly parentID?: Session.ID },
    ) {
      const resolved = yield* agents.resolve
      const selected = input.agent === undefined ? resolved : yield* agents.get(input.agent)
      const configuredModel = input.model ?? selected?.model
      const fallback = yield* catalog.model.default()
      const model =
        configuredModel ?? (fallback === undefined ? undefined : { provider: fallback.provider, id: fallback.id })
      if (model === undefined) return yield* Effect.die(new Error("Session creation requires a selectable Model"))
      const agent = input.agent ?? resolved.id
      const id = yield* crypto.randomUUIDv4.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Session.ID)), Effect.orDie)
      const now = yield* DateTime.nowAsDate
      const session = Session.Info.make({
        id,
        projectID: input.projectID,
        ...(input.parentID === undefined ? {} : { parentID: input.parentID }),
        title: input.title ?? "New session",
        agent,
        model,
        ...(input.scheduledTaskID === undefined ? {} : { scheduledTaskID: input.scheduledTaskID }),
        createdAt: now,
        updatedAt: now,
      })
      yield* database.use("sessionCreate", (db) =>
        Effect.gen(function* () {
          if (input.parentID === undefined) {
                    const project = yield* db
                      .select({ id: ProjectTable.id, archivedAt: ProjectTable.archivedAt })
                      .from(ProjectTable)
                      .where(and(eq(ProjectTable.workspaceID, workspaceID), eq(ProjectTable.id, input.projectID)))
                      .for("key share")
                      .pipe(Effect.map(Array.head))
                    if (Option.isNone(project)) return yield* new Project.NotFoundError({ projectID: input.projectID })
                    if (project.value.archivedAt !== null)
                      return yield* new Project.ArchivedError({ projectID: input.projectID })
                  } else {
                    // A child Session belongs to its parent's in-flight run, which archiving does not interrupt.
                    const parent = yield* db
                      .select({ id: SessionTable.id })
                      .from(SessionTable)
                      .where(
                        and(
                          eq(SessionTable.workspaceID, workspaceID),
                          eq(SessionTable.userID, owner.userID),
                          eq(SessionTable.id, input.parentID),
                        ),
                      )
                      .for("key share")
                      .pipe(Effect.map(Array.head))
                    if (Option.isNone(parent)) return yield* new NotFoundError({ sessionID: input.parentID })
          }
          yield* db.insert(SessionTable).values({
            id,
            workspaceID,
            userID: owner.userID,
            projectID: input.projectID,
            parentID: input.parentID,
            title: input.title,
            agent,
            model,
            scheduledTaskID: input.scheduledTaskID,
            timeCreated: now,
            timeUpdated: now,
          })
        }),
      )
      yield* bus.publish(SessionEvent.Created, { sessionID: id, session }, { created: now }).pipe(Effect.orDie)
      return session
    })
    const createChild = Effect.fn("Session.createChild")(function* (input: ChildCreateInput) {
      const parent = yield* database.use("sessionCreateChildParent", (db) =>
        db
          .select({
            projectID: SessionTable.projectID,
            userID: SessionTable.userID,
            scheduledTaskID: SessionTable.scheduledTaskID,
          })
          .from(SessionTable)
          .where(
            and(
              eq(SessionTable.workspaceID, workspaceID),
              eq(SessionTable.userID, owner.userID),
              eq(SessionTable.id, input.parentID),
            ),
          )
          .limit(1)
          .pipe(Effect.map(Array.head), Effect.orDie),
      )
      if (Option.isNone(parent)) return yield* new NotFoundError({ sessionID: input.parentID })
      // A Scheduled Task run is unattended end to end: a child Session inherits the same marker
      // so it is denied the same `ask` and question Tools and shares the same step budget.
      return yield* createSession({
        ...input,
        projectID: parent.value.projectID,
        ...(parent.value.scheduledTaskID === null ? {} : { scheduledTaskID: parent.value.scheduledTaskID }),
      }).pipe(Effect.catchTags({ "Project.NotFoundError": Effect.die, "Project.ArchivedError": Effect.die }))
    })
    /** Refuse new Messages while the Session's Project is archived. A missing Session is left to admission. */
    const requireActive = Effect.fn("Session.requireActive")(function* (sessionID: Session.ID) {
      const row = yield* database.use("sessionProjectArchived", (db) =>
        db
          .select({ projectID: ProjectTable.id, archivedAt: ProjectTable.archivedAt })
          .from(SessionTable)
          .innerJoin(
            ProjectTable,
            and(eq(ProjectTable.workspaceID, SessionTable.workspaceID), eq(ProjectTable.id, SessionTable.projectID)),
          )
          .where(and(eq(SessionTable.workspaceID, workspaceID), eq(SessionTable.id, sessionID)))
          .limit(1)
          .pipe(Effect.map(Array.head), Effect.orDie),
      )
      if (Option.isSome(row) && row.value.archivedAt !== null)
        return yield* new Project.ArchivedError({ projectID: row.value.projectID })
    })
    const getRow = Effect.fn("Session.getRow")(function* (sessionID: Session.ID) {
      const row = yield* database.use("sessionGetRow", (db) =>
        db
          .select()
          .from(SessionTable)
          .where(
            and(
              eq(SessionTable.workspaceID, workspaceID),
              eq(SessionTable.userID, owner.userID),
              eq(SessionTable.id, sessionID),
            ),
          )
          .limit(1)
          .pipe(Effect.map(Array.head), Effect.orDie),
      )
      if (Option.isNone(row)) return yield* new NotFoundError({ sessionID })
      return row.value
    })
    const deleteSession = Effect.fn("Session.deleteSession")(function* (
      sessionID: Session.ID,
    ): Effect.fn.Return<void, NotFoundError> {
      yield* getRow(sessionID)
      yield* execution.interrupt(sessionID, "superseded")
      yield* execution.awaitIdle(sessionID)
      const children = yield* database.use("sessionDeleteChildren", (db) =>
        db
          .select({ id: SessionTable.id })
          .from(SessionTable)
          .where(
            and(
              eq(SessionTable.workspaceID, workspaceID),
              eq(SessionTable.userID, owner.userID),
              eq(SessionTable.parentID, sessionID),
            ),
          )
          .orderBy(asc(SessionTable.id))
          .pipe(Effect.orDie),
      )
      yield* Effect.forEach(children, (child) => deleteSession(child.id), { concurrency: 1, discard: true })
      yield* database.use("sessionDeleteLock", (db) =>
        db
          .select({ id: SessionTable.id })
          .from(SessionTable)
          .where(
            and(
              eq(SessionTable.workspaceID, workspaceID),
              eq(SessionTable.userID, owner.userID),
              eq(SessionTable.id, sessionID),
            ),
          )
          .for("update")
          .pipe(
            Effect.map(Array.head),
            Effect.orDie,
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.fail(new NotFoundError({ sessionID })),
                onSome: () => Effect.void,
              }),
            ),
          ),
      )
      // The Entry is durable in the same transaction as the delete: a failed
      // append rolls the deletion back (fail-closed).
      yield* database
        .transact(
          Effect.gen(function* () {
            yield* database.use("sessionDelete", (db) =>
              db
                .delete(SessionTable)
                .where(
                  and(
                    eq(SessionTable.workspaceID, workspaceID),
                    eq(SessionTable.userID, owner.userID),
                    eq(SessionTable.id, sessionID),
                  ),
                ),
            )
            yield* audit.record({
              actor: Audit.member(owner),
              action: "session.delete",
              workspaceID,
              target: sessionID,
              outcome: "success",
            })
          }),
        )
        .pipe(Effect.orDie)
      yield* bus.publish(SessionEvent.Deleted, { sessionID }).pipe(Effect.orDie)
    })
    return Service.of({
      create: (input) =>
        createSession(input).pipe(
          Effect.catchTag("Session.NotFoundError", Effect.die),
          Effect.catchTag("EffectDrizzleQueryError", Effect.die),
        ),
      createChild: (input) => createChild(input).pipe(Effect.orDie),
      update: Effect.fn("Session.update")(function* (input) {
        const now = yield* DateTime.nowAsDate
        // Archiving or restoring is a visibility change, not Session activity: it keeps the activity time.
        const bumpsActivity = input.title !== undefined || input.projectID !== undefined || input.archived === undefined
        const session = yield* database
          .use("sessionUpdateLock", (db) =>
            Effect.gen(function* () {
              const current = yield* db
                .select()
                .from(SessionTable)
                .where(
                  and(
                    eq(SessionTable.workspaceID, workspaceID),
                    eq(SessionTable.userID, owner.userID),
                    eq(SessionTable.id, input.sessionID),
                  ),
                )
                .for("update")
                .pipe(Effect.map(Array.head), Effect.orDie)
              if (Option.isNone(current)) return yield* new NotFoundError({ sessionID: input.sessionID })
              const row = current.value
              if (input.projectID !== undefined) {
                const project = yield* db
                  .select({ id: ProjectTable.id })
                  .from(ProjectTable)
                  .where(and(eq(ProjectTable.workspaceID, workspaceID), eq(ProjectTable.id, input.projectID)))
                  .for("key share")
                  .pipe(Effect.map(Array.head), Effect.orDie)
                if (Option.isNone(project)) return yield* new Project.NotFoundError({ projectID: input.projectID })
              }
              const info = Session.Info.make({
                id: row.id,
                projectID: input.projectID ?? row.projectID,
                ...(row.parentID === null ? {} : { parentID: row.parentID }),
                title: input.title ?? row.title,
                ...(input.archived === undefined
                  ? row.archivedAt === null
                    ? {}
                    : { archivedAt: row.archivedAt }
                  : input.archived
                    ? { archivedAt: now }
                    : {}),
                agent: row.agent,
                model: row.model,
                ...(row.scheduledTaskID === null ? {} : { scheduledTaskID: row.scheduledTaskID }),
                createdAt: row.timeCreated,
                updatedAt: bumpsActivity ? now : row.timeUpdated,
              })
              yield* db
                .update(SessionTable)
                .set({
                  projectID: info.projectID,
                  title: info.title,
                  archivedAt: info.archivedAt ?? null,
                  timeUpdated: info.updatedAt,
                })
                .where(and(eq(SessionTable.workspaceID, workspaceID), eq(SessionTable.id, input.sessionID)))
              return info
            }),
          )
          .pipe(Effect.orDie)
        yield* bus.publish(SessionEvent.Updated, { sessionID: input.sessionID, session }, { created: now }).pipe(Effect.orDie)
        return session
      }),
      delete: deleteSession,
      list: Effect.fn("Session.list")(function* (request = {}) {
        const encodedCursor = request.cursor
        const cursor =
          encodedCursor === undefined
            ? undefined
            : yield* Effect.try(() => JSON.parse(Buffer.from(encodedCursor, "base64url").toString("utf8"))).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(ListCursor)),
                Effect.mapError(() => new InvalidCursorError()),
              )
        const search = request.search?.trim() || undefined
        if (
          cursor !== undefined &&
          (cursor.search !== search || cursor.parentID !== request.parentID || cursor.archived !== request.archived)
        )
          return yield* new InvalidCursorError()
        const limit = request.limit ?? 50
        const rows = yield* database.use("sessionList", (db) =>
          db
            .select()
            .from(SessionTable)
            .where(
              and(
                eq(SessionTable.workspaceID, workspaceID),
                eq(SessionTable.userID, owner.userID),
                search === undefined ? undefined : ilike(SessionTable.title, `%${search.replace(/[\\%_]/g, "\\$&")}%`),
                request.parentID === undefined
                  ? undefined
                  : request.parentID === null
                    ? isNull(SessionTable.parentID)
                    : eq(SessionTable.parentID, request.parentID),
                request.archived === undefined
                  ? undefined
                  : request.archived
                    ? isNotNull(SessionTable.archivedAt)
                    : isNull(SessionTable.archivedAt),
                // An archived Project hides its Sessions from every list except the archived one.
                request.archived === true
                  ? undefined
                  : notExists(
                      db
                        .select({ id: ProjectTable.id })
                        .from(ProjectTable)
                        .where(
                          and(
                            eq(ProjectTable.workspaceID, SessionTable.workspaceID),
                            eq(ProjectTable.id, SessionTable.projectID),
                            isNotNull(ProjectTable.archivedAt),
                          ),
                        ),
                    ),
                cursor === undefined
                  ? undefined
                  : or(
                      lt(SessionTable.timeUpdated, cursor.updatedAt),
                      and(eq(SessionTable.timeUpdated, cursor.updatedAt), gt(SessionTable.id, cursor.id)),
                    ),
              ),
            )
            .orderBy(desc(SessionTable.timeUpdated), asc(SessionTable.id))
            .limit(limit + 1)
            .pipe(Effect.orDie),
        )
        const data = rows.slice(0, limit).map((row) =>
          Session.Info.make({
            id: row.id,
            projectID: row.projectID,
            ...(row.parentID === null ? {} : { parentID: row.parentID }),
            title: row.title,
            ...(row.archivedAt === null ? {} : { archivedAt: row.archivedAt }),
            agent: row.agent,
            model: row.model,
            ...(row.scheduledTaskID === null ? {} : { scheduledTaskID: row.scheduledTaskID }),
            createdAt: row.timeCreated,
            updatedAt: row.timeUpdated,
          }),
        )
        const next = Array.last(data).pipe(
          Option.filter(() => rows.length > limit),
          Option.map((last) => ({
            cursor: Buffer.from(
              JSON.stringify({
                version: 2,
                kind: "session",
                updatedAt: last.updatedAt.toISOString(),
                id: last.id,
                ...(search === undefined ? {} : { search }),
                ...(request.parentID === undefined ? {} : { parentID: request.parentID }),
                ...(request.archived === undefined ? {} : { archived: request.archived }),
              }),
            ).toString("base64url"),
          })),
          Option.getOrElse(() => ({})),
        )
        return Session.Page.make({ data, ...next })
      }),
      get: Effect.fn("Session.get")(function* (sessionID) {
        const row = yield* database.use("sessionGet", (db) =>
          db
            .select()
            .from(SessionTable)
            .where(
              and(
                eq(SessionTable.workspaceID, workspaceID),
                eq(SessionTable.userID, owner.userID),
                eq(SessionTable.id, sessionID),
              ),
            )
            .limit(1)
            .pipe(Effect.map(Array.head), Effect.orDie),
        )
        if (Option.isNone(row)) return yield* new NotFoundError({ sessionID })
        const parsedCost = Number(row.value.usage_cost)
        return Session.Detail.make({
          id: row.value.id,
          projectID: row.value.projectID,
          ...(row.value.parentID === null ? {} : { parentID: row.value.parentID }),
          title: row.value.title,
          ...(row.value.archivedAt === null ? {} : { archivedAt: row.value.archivedAt }),
          agent: row.value.agent,
          model: row.value.model,
          ...(row.value.scheduledTaskID === null ? {} : { scheduledTaskID: row.value.scheduledTaskID }),
          createdAt: row.value.timeCreated,
          updatedAt: row.value.timeUpdated,
          usage: Usage.make({
            cost: Number.isFinite(parsedCost) && parsedCost >= 0 ? Math.min(parsedCost, 999_999_999_999_999) : 0,
            costComplete: row.value.usageCostComplete,
            tokens: {
              ...(row.value.usageTotal === null
                ? {}
                : {
                    total:
                      row.value.usageTotal < 0n
                        ? 0
                        : Number(
                            row.value.usageTotal > BigInt(Number.MAX_SAFE_INTEGER)
                              ? BigInt(Number.MAX_SAFE_INTEGER)
                              : row.value.usageTotal,
                          ),
                  }),
              input:
                row.value.usageInput < 0n
                  ? 0
                  : Number(
                      row.value.usageInput > BigInt(Number.MAX_SAFE_INTEGER)
                        ? BigInt(Number.MAX_SAFE_INTEGER)
                        : row.value.usageInput,
                    ),
              output:
                row.value.usageOutput < 0n
                  ? 0
                  : Number(
                      row.value.usageOutput > BigInt(Number.MAX_SAFE_INTEGER)
                        ? BigInt(Number.MAX_SAFE_INTEGER)
                        : row.value.usageOutput,
                    ),
              reasoning:
                row.value.usageReasoning < 0n
                  ? 0
                  : Number(
                      row.value.usageReasoning > BigInt(Number.MAX_SAFE_INTEGER)
                        ? BigInt(Number.MAX_SAFE_INTEGER)
                        : row.value.usageReasoning,
                    ),
              cache: {
                read:
                  row.value.usageCacheRead < 0n
                    ? 0
                    : Number(
                        row.value.usageCacheRead > BigInt(Number.MAX_SAFE_INTEGER)
                          ? BigInt(Number.MAX_SAFE_INTEGER)
                          : row.value.usageCacheRead,
                      ),
                write:
                  row.value.usageCacheWrite < 0n
                    ? 0
                    : Number(
                        row.value.usageCacheWrite > BigInt(Number.MAX_SAFE_INTEGER)
                          ? BigInt(Number.MAX_SAFE_INTEGER)
                          : row.value.usageCacheWrite,
                      ),
              },
            },
          }),
        })
      }),
      messages: Effect.fn("Session.messages")(function* (request) {
        const owned = yield* database.use("sessionMessageOwner", (db) =>
          db
            .select({ id: SessionTable.id })
            .from(SessionTable)
            .where(
              and(
                eq(SessionTable.workspaceID, workspaceID),
                eq(SessionTable.userID, owner.userID),
                eq(SessionTable.id, request.sessionID),
              ),
            )
            .limit(1)
            .pipe(Effect.map(Array.head), Effect.orDie),
        )
        if (Option.isNone(owned)) return yield* new NotFoundError({ sessionID: request.sessionID })
        const order = request.order ?? "desc"
        const limit = request.limit ?? 50
        const anchor =
          request.cursor === undefined
            ? undefined
            : yield* database.use("sessionMessageAnchor", (db) =>
                db
                  .select({ sequence: SessionMessageTable.sequence })
                  .from(SessionMessageTable)
                  .where(
                    and(
                      eq(SessionMessageTable.sessionID, request.sessionID),
                       eq(SessionMessageTable.id, request.cursor!.id),
                    ),
                  )
                  .limit(1)
                  .pipe(Effect.map(Array.head), Effect.orDie),
              )
        if (request.cursor !== undefined && (anchor === undefined || Option.isNone(anchor))) return []
        const backward = request.cursor?.direction === "previous"
        const ascending = backward ? order === "desc" : order === "asc"
        const condition =
          anchor === undefined || Option.isNone(anchor)
            ? undefined
            : backward
              ? order === "asc"
                ? lt(SessionMessageTable.sequence, anchor.value.sequence)
                : gt(SessionMessageTable.sequence, anchor.value.sequence)
              : order === "asc"
                ? gt(SessionMessageTable.sequence, anchor.value.sequence)
                : lt(SessionMessageTable.sequence, anchor.value.sequence)
        const rows = yield* database.use("sessionMessages", (db) =>
          db
            .select()
            .from(SessionMessageTable)
            .where(
              and(
                eq(SessionMessageTable.sessionID, request.sessionID),
                condition,
              ),
            )
            .orderBy(ascending ? asc(SessionMessageTable.sequence) : desc(SessionMessageTable.sequence))
            .limit(limit)
            .pipe(Effect.orDie),
        )
        const selected = backward ? [...rows].reverse() : rows
        return yield* Effect.forEach(selected, (row) =>
          Schema.decodeUnknownEffect(Message)(row.data).pipe(Effect.orDie),
        )
      }),
      inbox: Effect.fn("Session.inbox")(function* (sessionID) {
        yield* getRow(sessionID)
        const rows = yield* database.use("sessionInboxRead", (db) =>
          db
            .select()
            .from(SessionInboxTable)
            .where(eq(SessionInboxTable.sessionID, sessionID))
            .orderBy(sql`case when ${SessionInboxTable.delivery} = 'steer' then 0 else 1 end`, asc(SessionInboxTable.admittedSequence))
            .pipe(Effect.orDie),
        )
        return yield* Effect.forEach(rows, (row) =>
          Schema.decodeUnknownEffect(SessionInbox.Info)({
            id: row.id,
            sessionID: row.sessionID,
            admittedSequence: row.admittedSequence,
            createdAt: row.timeCreated.toISOString(),
            type: row.type,
            payload: row.payload,
            delivery: row.delivery,
          }).pipe(Effect.orDie),
        )
      }),
      prompt: Effect.fn("Session.prompt")((request) =>
        requireActive(request.sessionID).pipe(
          Effect.andThen(
            execution
              .admitPrompt(request)
              .pipe(
                Effect.mapError(
                  (error) => new PromptConflictError({ sessionID: request.sessionID, messageID: error.messageID }),
                ),
              ),
          ),
          Effect.flatMap((admitted) =>
            admitted === undefined
              ? Effect.fail(new NotFoundError({ sessionID: request.sessionID }))
              : admitted.type !== "user"
                ? Effect.die(new Error("Prompt admission did not produce user input"))
                : Effect.succeed(
                  Admitted.make({
                    id: admitted.id,
                    sessionID: admitted.sessionID,
                    text: admitted.payload.text,
                    ...(admitted.payload.agents === undefined ? {} : { agents: [...admitted.payload.agents] }),
                    ...(admitted.payload.metadata === undefined ? {} : { metadata: admitted.payload.metadata }),
                    delivery: admitted.delivery,
                    admittedSequence: admitted.admittedSequence,
                    createdAt: admitted.createdAt,
                  }),
                ),
          ),
        ),
      ),
      synthetic: Effect.fn("Session.synthetic")((request) =>
        execution.admitSynthetic(request).pipe(
          Effect.mapError(
            (error) => new SyntheticConflictError({ sessionID: request.sessionID, messageID: error.messageID }),
          ),
          Effect.flatMap((admitted) =>
            admitted === undefined
              ? Effect.fail(new NotFoundError({ sessionID: request.sessionID }))
              : admitted.type !== "synthetic"
                ? Effect.die(new Error("Synthetic admission did not produce synthetic input"))
                : Effect.succeed(
                    SessionInbox.Synthetic.make({
                      id: admitted.id,
                      sessionID: admitted.sessionID,
                      createdAt: admitted.createdAt,
                      type: admitted.type,
                      payload: admitted.payload,
                      delivery: admitted.delivery,
                    }),
                  ),
          ),
        ),
      ),
      compact: Effect.fn("Session.compact")((request) =>
        execution.admitCompaction(request).pipe(
          Effect.mapError(
            (error) => new CompactionConflictError({ sessionID: request.sessionID, messageID: error.messageID }),
          ),
          Effect.flatMap((admitted) =>
            admitted === undefined
              ? Effect.fail(new NotFoundError({ sessionID: request.sessionID }))
              : Effect.succeed(
                  Admitted.make({
                    id: admitted.id,
                    sessionID: admitted.sessionID,
                    text: "",
                    delivery: admitted.delivery,
                    admittedSequence: admitted.admittedSequence,
                    createdAt: admitted.createdAt,
                  }),
                ),
          ),
        ),
      ),
      active: execution.active,
      interrupt: Effect.fn("Session.interrupt")(function* (sessionID, reason) {
        yield* getRow(sessionID)
        yield* execution.interrupt(sessionID, reason)
      }),
      resume: Effect.fn("Session.resume")(function* (sessionID) {
        yield* getRow(sessionID)
        yield* execution.resume(sessionID)
      }),
      awaitIdle: Effect.fn("Session.awaitIdle")(function* (sessionID) {
        yield* getRow(sessionID)
        yield* execution.awaitIdle(sessionID)
      }),
      background: Effect.fn("Session.background")(function* (sessionID) {
        yield* getRow(sessionID)
        yield* execution.background(sessionID).pipe(
          Effect.mapError((error) => new SyntheticConflictError({ sessionID, messageID: error.messageID })),
          Effect.catchTag("Session.SyntheticConflictError", Effect.die),
          Effect.filterOrFail(
            (exists) => exists,
            () => new NotFoundError({ sessionID }),
          ),
        )
      }),
      switchAgent: Effect.fn("Session.switchAgent")(function* (request) {
        const selected = yield* agents.get(request.agent)
        if (selected === undefined) return yield* new NotFoundError({ sessionID: request.sessionID })
        const id = yield* crypto.randomUUIDv4.pipe(Effect.flatMap(Schema.decodeUnknownEffect(ID)), Effect.orDie)
        const now = yield* DateTime.nowAsDate
        const message = yield* database.transactRoot(database.use("sessionSwitchAgent", (tx) =>
          Effect.gen(function* () {
                    const row = yield* tx
                      .select()
                      .from(SessionTable)
                      .where(
                        and(
                          eq(SessionTable.workspaceID, workspaceID),
                          eq(SessionTable.userID, owner.userID),
                          eq(SessionTable.id, request.sessionID),
                        ),
                      )
                      .for("update")
                      .pipe(Effect.map(Array.head))
            if (Option.isNone(row)) return yield* new SelectionMissingError()
            const allocated = yield* allocate(database, request.sessionID, 1)
            const sequence = allocated === 1 ? yield* allocate(database, request.sessionID, 1) : allocated
            const message = AgentSwitched.make({
              id,
              sessionID: request.sessionID,
              sequence,
              type: "agent-switched",
              agent: request.agent,
              createdAt: now,
            })
            yield* tx.insert(SessionMessageTable).values({
              id,
              sessionID: request.sessionID,
              sequence: message.sequence,
              type: message.type,
              data: message,
              timeCreated: now,
              timeUpdated: now,
            })
            yield* tx
              .update(SessionTable)
              .set({ agent: request.agent, timeUpdated: now })
              .where(eq(SessionTable.id, request.sessionID))
            return message
          }),
        )).pipe(
          Effect.catchTag("Session.SelectionMissingError", () =>
            Effect.fail(new NotFoundError({ sessionID: request.sessionID })),
          ),
          Effect.orDie,
        )
        yield* bus.publish(SessionEvent.AgentSwitched, { sessionID: request.sessionID, message, agent: request.agent }, { created: now }).pipe(Effect.orDie)
      }),
      switchModel: Effect.fn("Session.switchModel")(function* (request) {
        const id = yield* crypto.randomUUIDv4.pipe(Effect.flatMap(Schema.decodeUnknownEffect(ID)), Effect.orDie)
        const now = yield* DateTime.nowAsDate
        const message = yield* database.transactRoot(database.use("sessionSwitchModel", (tx) =>
          Effect.gen(function* () {
                    const row = yield* tx
                      .select()
                      .from(SessionTable)
                      .where(
                        and(
                          eq(SessionTable.workspaceID, workspaceID),
                          eq(SessionTable.userID, owner.userID),
                          eq(SessionTable.id, request.sessionID),
                        ),
                      )
                      .for("update")
                      .pipe(Effect.map(Array.head))
            if (Option.isNone(row)) return yield* new SelectionMissingError()
                    if (
                      row.value.model.provider === request.model.provider &&
                      row.value.model.id === request.model.id &&
                      (row.value.model.variant ?? "default") === (request.model.variant ?? "default")
                    )
              return yield* new ModelSameError()
            const allocated = yield* allocate(database, request.sessionID, 1)
            const sequence = allocated === 1 ? yield* allocate(database, request.sessionID, 1) : allocated
            const message = ModelSwitched.make({
              id,
              sessionID: request.sessionID,
              sequence,
              type: "model-switched",
              model: request.model,
              createdAt: now,
            })
            yield* tx.insert(SessionMessageTable).values({ id, sessionID: request.sessionID, sequence: message.sequence, type: message.type, data: message, timeCreated: now, timeUpdated: now })
            yield* tx.update(SessionTable).set({ model: request.model, timeUpdated: now }).where(eq(SessionTable.id, request.sessionID))
            return message
          }),
        )).pipe(
          Effect.catchTag("Session.ModelSameError", () => Effect.succeed(undefined)),
          Effect.catchTag("Session.SelectionMissingError", () => Effect.fail(new NotFoundError({ sessionID: request.sessionID }))),
          Effect.orDie,
        )
        if (message !== undefined)
          yield* bus.publish(SessionEvent.ModelSwitched, { sessionID: request.sessionID, message, model: request.model }, { created: now }).pipe(Effect.orDie)
      }),
    })
  }),
)

/**
 * Compatibility construction for direct consumers while they migrate to the
 * member-bound node. Production graphs must bind `Actor.Binding` instead.
 */
export const layer = (workspaceID: Workspace.ID, owner: Owner) =>
  memberLayer.pipe(
    // Direct callers may build multiple member layers in one parent scope.
    // Their construction-time bindings must never share a retained Session.
    Layer.fresh,
    Layer.provide(Audit.layer),
    Layer.provide(
      Layer.succeed(Actor.Binding.Service, {
        workspaceID,
        accountID: owner.accountID,
        userID: owner.userID,
        role: owner.role,
      }),
    ),
  )

/** Canonical Session-owned member graph. */
export const node = SessionGraph.node
/** Supported Session-aware Permission integration declaration. */
export const permission = SessionPermission.node
/** Minimal Session-owned readiness graph, including Session Permission policy. */
export const ready = SessionGraph.ready
