/** Exposes the Permission capability owned by this module. */
export * as Permission from "./permission.js"

import { PermissionSchema } from "@bymorning/schema/permission"
import { Session } from "@bymorning/schema/session"
import { and, eq } from "drizzle-orm"
import { Context, Deferred, Effect, Exit, Layer, Schema, SynchronizedRef } from "effect"
import { Database } from "./database.js"
import { PermissionSavedTable } from "./database/schema/permission.sql.js"
import { PermissionEvaluation } from "./permission/evaluation.js"
import { Workspace } from "@bymorning/schema/workspace"

/** The requested pending Permission does not exist for the supplied Session. */
export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Permission.NotFoundError", {
  requestID: PermissionSchema.ID,
}) {}

/** A user rejected a pending Permission request, optionally with corrective feedback. */
export class RejectedError extends Schema.TaggedError<RejectedError>()("Permission.RejectedError", {
  feedback: Schema.optionalKey(Schema.String),
}) {
  override get message() {
    return this.feedback ?? "Permission rejected"
  }
}

/** Configured policy denied a Permission request. */
export class BlockedError extends Schema.TaggedError<BlockedError>()("Permission.BlockedError", {
  rules: PermissionSchema.Ruleset,
  permission: Schema.String,
  resources: Schema.Array(Schema.String),
}) {
  override get message() {
    return `Permission denied: ${this.permission}`
  }
}

/** Persistent Permission grants are unavailable; Workspace rules are the only permanent authority. */
export class PermanentError extends Schema.TaggedError<PermanentError>()("Permission.PermanentError", {}) {
  override get message() {
    return "Permanent permission grants are unavailable; ask for a Workspace rule instead"
  }
}

/** Public Permission V2 authority. */
export interface Interface {
  readonly ask: (
    input: PermissionSchema.AssertInput,
  ) => Effect.Effect<PermissionSchema.AskResult, Session.NotFoundError>
  readonly assert: (
    input: PermissionSchema.AssertInput,
  ) => Effect.Effect<void, BlockedError | RejectedError | Session.NotFoundError>
  readonly reply: (input: PermissionSchema.ReplyInput) => Effect.Effect<void, NotFoundError | PermanentError>
  readonly get: (input: PermissionSchema.RequestInput) => Effect.Effect<PermissionSchema.Request, NotFoundError>
  readonly forSession: (
    sessionID: Session.ID,
  ) => Effect.Effect<ReadonlyArray<PermissionSchema.Request>, Session.NotFoundError>
  readonly list: Effect.Effect<ReadonlyArray<PermissionSchema.Request>>
  readonly saved: Effect.Effect<ReadonlyArray<PermissionSchema.Saved>>
  readonly forget: (savedID: PermissionSchema.SavedID) => Effect.Effect<void>
}

/** Public Permission V2 authority. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Permission") {}

type Settlement =
  { readonly status: "allowed" } | { readonly status: "denied"; readonly error: RejectedError | BlockedError }

interface Evaluation {
  readonly effect: PermissionSchema.Effect
  readonly revision: number
  readonly rules: PermissionSchema.Ruleset
}

/** Evaluate ordered Permission rules for one action and resource. */
export const evaluate = PermissionEvaluation.evaluate

/** Process-local publication adapters supplied by the runtime composition root. */
export interface LayerOptions {
  /** Resolve configured rules through the runtime that owns Session and Agent persistence. */
  readonly configured: (
    sessionID: Session.ID,
    agent?: import("@bymorning/schema/agent").ID,
  ) => Effect.Effect<PermissionSchema.Ruleset, Session.NotFoundError>
  readonly asked?: (request: PermissionSchema.Request) => Effect.Effect<void>
  readonly replied?: (input: {
    readonly sessionID: Session.ID
    readonly requestID: PermissionSchema.ID
    readonly reply: PermissionSchema.Reply
  }) => Effect.Effect<void>
  /** Test synchronization hook invoked after an Ask becomes discoverable. */
  readonly opened?: (request: PermissionSchema.Request) => Effect.Effect<void>
}

interface Item {
  readonly request: PermissionSchema.Request
  readonly agent?: import("@bymorning/schema/agent").ID
  readonly deferred: Deferred.Deferred<Settlement>
}

type Entry =
  | { readonly phase: "opening"; readonly item: Item; readonly ready: Deferred.Deferred<void> }
  | { readonly phase: "pending"; readonly item: Item }
  | { readonly phase: "settling-before-commit"; readonly item: Item }

type ReplyClaim =
  | { readonly _tag: "absent" }
  | { readonly _tag: "opening"; readonly ready: Deferred.Deferred<void> }
  | { readonly _tag: "claimed"; readonly existing: Item; readonly selected: ReadonlyArray<Item> }

interface Registry {
  readonly entries: ReadonlyMap<PermissionSchema.ID, Entry>
  readonly revision: number
  readonly closed: boolean
}

/** Scoped PostgreSQL-backed implementation with one process-local pending registry. */
export const layerWith = (workspaceID: Workspace.ID, options: LayerOptions) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const database = yield* Database.Service
      const registry = yield* SynchronizedRef.make<Registry>({ entries: new Map(), revision: 0, closed: false })
      const publishAsked = options.asked ?? (() => Effect.void)
      const publishReplied = options.replied ?? (() => Effect.void)
      const opened = options.opened ?? (() => Effect.void)

      const bestEffortReply = (item: Item, reply: PermissionSchema.Reply) =>
        publishReplied({ sessionID: item.request.sessionID, requestID: item.request.id, reply }).pipe(
          Effect.exit,
          Effect.flatMap((exit) =>
            Exit.isFailure(exit)
              ? Effect.logWarning("Permission replied event publication failed").pipe(
                  Effect.annotateLogs({ requestID: item.request.id, reply }),
                )
              : Effect.void,
          ),
        )

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          const entries = yield* SynchronizedRef.modify(registry, (state) => [
            Array.from(state.entries.values()),
            { ...state, entries: new Map(), closed: true },
          ])
          yield* Effect.forEach(
            entries,
            (entry) => {
              const settlement = { status: "denied", error: new RejectedError({}) } satisfies Settlement
              return Deferred.succeed(entry.item.deferred, settlement)
            },
            {
              discard: true,
            },
          )
          yield* Effect.forEach(
            entries,
            (entry) => (entry.phase === "opening" ? Deferred.succeed(entry.ready, undefined) : Effect.void),
            { discard: true },
          )
        }),
      )

      const saved = database
        .use("Permission.saved", (db) =>
          db
            .select({
              id: PermissionSavedTable.id,
              action: PermissionSavedTable.action,
              resource: PermissionSavedTable.resource,
            })
            .from(PermissionSavedTable)
            .where(eq(PermissionSavedTable.workspaceId, workspaceID))
            .pipe(Effect.orDie),
        )
        .pipe(Effect.withSpan("Permission.saved"))
      const configured = Effect.fn("Permission.configured")(options.configured)
      const blocked = (input: PermissionSchema.AssertInput, rules: PermissionSchema.Ruleset) =>
        new BlockedError({
          rules: rules.filter((rule) => PermissionEvaluation.match(input.action, rule.action)),
          permission: input.action,
          resources: input.resources,
        })
      const denied = (input: PermissionSchema.AssertInput, rules: PermissionSchema.Ruleset) =>
        input.resources.some((resource) => evaluate(input.action, resource, rules).effect === "deny")
      const evaluateInput = Effect.fnUntraced(function* (
        input: PermissionSchema.AssertInput,
        agent?: import("@bymorning/schema/agent").ID,
      ): Effect.fn.Return<Evaluation, Session.NotFoundError> {
        const revision = (yield* SynchronizedRef.get(registry)).revision
        const rules = yield* configured(input.sessionID, agent)
        if (denied(input, rules)) return { effect: "deny" as const, revision, rules }
        const effects = input.resources.map((resource) => evaluate(input.action, resource, rules).effect)
        const effect = (
          effects.includes("deny") ? "deny" : effects.includes("ask") ? "ask" : "allow"
        ) satisfies PermissionSchema.Effect
        return {
          effect,
          revision,
          rules,
        }
      })
      const makeRequest = (input: PermissionSchema.AssertInput): PermissionSchema.Request => ({
        id: input.id ?? PermissionSchema.ID.create(),
        sessionID: input.sessionID,
        action: input.action,
        resources: input.resources,
        ...(input.save === undefined ? {} : { save: input.save }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        ...(input.source === undefined ? {} : { source: input.source }),
      })
      const open = Effect.fnUntraced(function* (
        request: PermissionSchema.Request,
        revision: number,
        agent?: import("@bymorning/schema/agent").ID,
        reevaluate: (
          input: PermissionSchema.AssertInput,
          agent?: import("@bymorning/schema/agent").ID,
        ) => Effect.Effect<Evaluation, Session.NotFoundError> = evaluateInput,
      ): Effect.fn.Return<
        { readonly item: Item; readonly effect: PermissionSchema.Effect } | undefined,
        Session.NotFoundError
      > {
        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const deferred = yield* Deferred.make<Settlement>()
            const ready = yield* Deferred.make<void>()
            const item = { request, ...(agent === undefined ? {} : { agent }), deferred } satisfies Item
            const entry = { phase: "opening", item, ready } satisfies Entry
            const pendingEntry = { phase: "pending", item } satisfies Entry
            const claim = yield* SynchronizedRef.modify(registry, (state) => {
              if (state.closed) return ["closed" as const, state]
              if (state.revision !== revision) return ["stale" as const, state]
              if (state.entries.has(request.id)) return ["duplicate" as const, state]
              const entries = new Map(state.entries)
              entries.set(request.id, entry)
              return ["opened" as const, { ...state, entries }]
            })
            if (claim === "stale") return undefined
            if (claim === "duplicate")
              return yield* Effect.die(new Error(`Duplicate pending permission ID: ${request.id}`))
            if (claim === "closed") {
              yield* Deferred.succeed(deferred, { status: "denied", error: new RejectedError({}) })
              return { item, effect: "deny" as const }
            }

            const cleanup = Effect.gen(function* () {
              const removed = yield* SynchronizedRef.modify(registry, (state) => {
                const current = state.entries.get(request.id)
                if (current !== entry || current.phase !== "opening") return [false, state]
                const entries = new Map(state.entries)
                entries.delete(request.id)
                return [true, { ...state, entries }]
              })
              if (removed) {
                yield* Deferred.succeed(deferred, { status: "denied", error: new RejectedError({}) })
                yield* Deferred.succeed(ready, undefined)
              }
            })
            const lifecycle = Effect.fnUntraced(function* (
              initial: Evaluation,
            ): Effect.fn.Return<
              { readonly item: Item; readonly effect: PermissionSchema.Effect },
              Session.NotFoundError
            > {
              yield* restore(publishAsked(request))
              yield* restore(opened(request))
              let evaluated = initial
              while (true) {
                const current = yield* SynchronizedRef.modify(registry, (state) => {
                  if (state.entries.get(request.id) !== entry) return ["removed" as const, state]
                  if (state.revision !== evaluated.revision) return ["stale" as const, state]
                  const entries = new Map(state.entries)
                  if (evaluated.effect === "ask") {
                    entries.set(request.id, pendingEntry)
                    return ["pending" as const, { ...state, entries }]
                  }
                  entries.delete(request.id)
                  return ["settled" as const, { ...state, entries }]
                })
                if (current === "stale") {
                  evaluated = yield* restore(reevaluate(request, agent))
                  continue
                }
                if (current === "removed") {
                  yield* Deferred.succeed(ready, undefined)
                  const settlement = yield* Deferred.await(deferred)
                  const effect = (settlement.status === "allowed" ? "allow" : "deny") satisfies PermissionSchema.Effect
                  return { item, effect }
                }
                if (current === "pending") {
                  yield* Deferred.succeed(ready, undefined)
                  return { item, effect: "ask" as const }
                }
                const settlement = (
                  evaluated.effect === "allow"
                    ? { status: "allowed" }
                    : { status: "denied", error: blocked(request, evaluated.rules) }
                ) satisfies Settlement
                yield* Deferred.succeed(deferred, settlement)
                yield* Deferred.succeed(ready, undefined)
                yield* restore(bestEffortReply(item, evaluated.effect === "allow" ? "always" : "reject"))
                return { item, effect: evaluated.effect }
              }
            })
            return yield* lifecycle({ effect: "ask", revision, rules: [] }).pipe(
              Effect.onExit((exit) => (Exit.isFailure(exit) ? cleanup : Effect.void)),
            )
          }),
        )
      })

      const ask = Effect.fn("Permission.ask")(function* (input: PermissionSchema.AssertInput) {
        while (true) {
          const result = yield* evaluateInput(input, input.agent)
          const value = makeRequest(input)
          if (result.effect !== "ask") return { id: value.id, effect: result.effect }
          const opened = yield* open(value, result.revision, input.agent)
          if (opened !== undefined) return { id: value.id, effect: opened.effect }
        }
      })
      const awaitSettlement = (item: Item) =>
        Deferred.await(item.deferred).pipe(
          Effect.ensuring(
            SynchronizedRef.update(registry, (state) => {
              const current = state.entries.get(item.request.id)
              if (current?.item !== item || current.phase === "opening") return state
              const entries = new Map(state.entries)
              entries.delete(item.request.id)
              return { ...state, entries }
            }),
          ),
        )
      const assert = Effect.fn("Permission.assert")((input: PermissionSchema.AssertInput) =>
        Effect.gen(function* () {
          while (true) {
            const result = yield* evaluateInput(input, input.agent)
            if (result.effect === "deny") return yield* blocked(input, result.rules)
            if (result.effect === "allow") return undefined
            const opened = yield* open(makeRequest(input), result.revision, input.agent)
            if (opened === undefined) continue
            const settlement = yield* awaitSettlement(opened.item)
            if (settlement.status === "allowed") return undefined
            return yield* settlement.error
          }
        }),
      )

      const closeAll = (items: ReadonlyArray<Item>) =>
        SynchronizedRef.update(registry, (state) => {
          const entries = new Map(state.entries)
          for (const item of items) {
            const current = entries.get(item.request.id)
            if (current?.item === item && current.phase === "settling-before-commit") entries.delete(item.request.id)
          }
          return { ...state, entries }
        })
      const commitAllowed = (item: Item) =>
        Effect.gen(function* () {
          // Removing the entry hands settlement ownership from the layer finalizer to this
          // uninterruptible caller. If shutdown cleared it first, the finalizer owns both the
          // Deferred and (for a durable settlement) its event.
          const owned = yield* SynchronizedRef.modify(registry, (state) => {
            const current = state.entries.get(item.request.id)
            if (
              current?.item !== item ||
              current.phase !== "settling-before-commit"
            )
              return [false, state]
            const entries = new Map(state.entries)
            entries.delete(item.request.id)
            return [true, { ...state, entries }]
          })
          if (!owned) return false
          yield* Deferred.succeed(item.deferred, { status: "allowed" as const })
          return true
        })

      const claimReply = Effect.fnUntraced(function* (input: PermissionSchema.ReplyInput) {
        while (true) {
          const claimed = yield* SynchronizedRef.modify<Registry, ReplyClaim>(registry, (state) => {
            const entry = state.entries.get(input.requestID)
            if (entry === undefined || entry.item.request.sessionID !== input.sessionID)
              return [{ _tag: "absent" as const }, state]
            if (entry.phase === "opening") return [{ _tag: "opening" as const, ready: entry.ready }, state]
            if (entry.phase === "settling-before-commit")
              return [{ _tag: "absent" as const }, state]
            const selected =
              input.reply === "reject"
                ? Array.from(state.entries.values()).filter(
                    (candidate): candidate is Extract<Entry, { phase: "pending" }> =>
                      candidate.phase === "pending" && candidate.item.request.sessionID === input.sessionID,
                  )
                : [entry]
            const entries = new Map(state.entries)
            for (const candidate of selected)
              entries.set(candidate.item.request.id, { phase: "settling-before-commit", item: candidate.item })
            return [
              { _tag: "claimed" as const, existing: entry.item, selected: selected.map(({ item }) => item) },
              { ...state, entries },
            ]
          })
          if (claimed._tag === "opening") {
            yield* Deferred.await(claimed.ready)
            continue
          }
          return claimed
        }
      })
      const restore = (items: ReadonlyArray<Item>) =>
        SynchronizedRef.update(registry, (state) => {
          if (state.closed) return state
          const entries = new Map(state.entries)
          for (const item of items) {
            const current = entries.get(item.request.id)
            if (current?.phase === "settling-before-commit" && current.item === item)
              entries.set(item.request.id, { phase: "pending", item })
          }
          return { ...state, entries }
        })

      const reply = Effect.fn("Permission.reply")((input: PermissionSchema.ReplyInput) =>
        Effect.uninterruptibleMask((restoreInterrupt) =>
          Effect.gen(function* () {
            if (input.reply === "always") return yield* new PermanentError()
            const claimed = yield* restoreInterrupt(claimReply(input))
            if (claimed._tag === "absent") return yield* new NotFoundError({ requestID: input.requestID })
            if (input.reply === "reject") {
              for (const item of claimed.selected) {
                yield* Deferred.succeed(item.deferred, {
                  status: "denied",
                  error:
                    item === claimed.existing && input.message !== undefined
                      ? new RejectedError({ feedback: input.message })
                      : new RejectedError({}),
                })
              }
              // Every claimed Deferred is terminal and every registry entry is removed before
              // publication becomes interruptible. An interrupted publisher cannot strand claims.
              yield* closeAll(claimed.selected)
              for (const item of claimed.selected) yield* restoreInterrupt(bestEffortReply(item, "reject"))
              return undefined
            }
            const owned = yield* commitAllowed(claimed.existing)
            if (owned) yield* restoreInterrupt(bestEffortReply(claimed.existing, input.reply))
            return undefined
          }),
        ),
      )

      const get = Effect.fn("Permission.get")(function* (input: PermissionSchema.RequestInput) {
        while (true) {
          const entry = (yield* SynchronizedRef.get(registry)).entries.get(input.requestID)
          if (
            entry === undefined ||
            entry.item.request.sessionID !== input.sessionID ||
            entry.phase === "settling-before-commit"
          )
            return yield* new NotFoundError({ requestID: input.requestID })
          if (entry.phase === "opening") {
            yield* Deferred.await(entry.ready)
            continue
          }
          return entry.item.request
        }
      })
      const forSession = Effect.fn("Permission.forSession")(function* (sessionID: Session.ID) {
        yield* configured(sessionID)
        return Array.from((yield* SynchronizedRef.get(registry)).entries.values())
          .filter((entry) => entry.phase === "pending" && entry.item.request.sessionID === sessionID)
          .map((entry) => entry.item.request)
      })
      const list = Effect.gen(function* () {
        return Array.from((yield* SynchronizedRef.get(registry)).entries.values())
          .filter((entry) => entry.phase === "pending")
          .map((entry) => entry.item.request)
      }).pipe(Effect.withSpan("Permission.list"))
      const forget = Effect.fn("Permission.forget")(function* (savedID: PermissionSchema.SavedID) {
        yield* database.use("Permission.forget", (db) =>
          db
            .delete(PermissionSavedTable)
            .where(and(eq(PermissionSavedTable.workspaceId, workspaceID), eq(PermissionSavedTable.id, savedID)))
            .pipe(Effect.orDie),
        )
      })
      return Context.make(Service, Service.of({ ask, assert, reply, get, forSession, list, saved, forget }))
    }),
  )
