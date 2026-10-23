/** Installation security record authority. */
export * as Audit from "./audit.js"

import { Audit } from "@bymorning/schema/audit"
import type { AccountActor, Info as ActorInfo } from "@bymorning/schema/actor"
import type { Account } from "@bymorning/schema/account"
import type { Workspace } from "@bymorning/schema/workspace"
import { makeGlobalNode, makeWorkspaceNode, tags, type GlobalNode } from "@bymorning/util/effect/app-node"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { Config, Context, DateTime, Effect, Layer, Schema } from "effect"
// Import the binding submodule directly: actor.ts reaches oauth.ts, which
// depends on Audit — importing the package-level actor module from here would
// evaluate a cycle.
import { Binding } from "./actor/binding.js"
import { Database } from "./database.js"
import { PluginHooks } from "./plugin/hooks.js"
import { digest, normalize, verifyChain } from "./audit/chain.js"
import { writeEntry } from "./audit/emit.js"
import { run } from "./audit/prune.js"
import { recorderLayer } from "./audit/recorder.js"
import { make } from "./audit/store.js"

export const ID = Audit.ID
export type ID = Audit.ID
export const Action = Audit.Action
export type Action = Audit.Action
export const Principal = Audit.Principal
export type Principal = Audit.Principal
export const Outcome = Audit.Outcome
export type Outcome = Audit.Outcome
export const Entry = Audit.Entry
export type Entry = Audit.Entry

export { digest, verifyChain }

/** The security record could not be persisted or read. */
export class StoreError extends Schema.TaggedError<StoreError>()("Audit.StoreError", { cause: Schema.Defect() }) {}

/** A list cursor is malformed or belongs to different filters. */
export class CursorError extends Schema.TaggedError<CursorError>()("Audit.CursorError", {}) {}

/** Facts of one security-relevant occurrence, supplied by the domain that performed it. */
export interface RecordInput {
  /** Edge-derived principal; never derived from ambient request state by Core. */
  readonly actor: Principal
  readonly action: Action
  readonly workspaceID?: Workspace.ID
  /** Domain-shaped object identifier, such as a Session ID or Integration key. */
  readonly target?: string
  /** Secret-free structured detail; identifiers only, never values. */
  readonly detail?: Record<string, unknown>
  readonly outcome: Outcome
  /** Request network context; defaults to the edge-supplied RequestContext. */
  readonly context?: Audit.Context
}

/** Entry page filters. Reads are newest-first and cursor-paginated. */
export interface ListInput {
  readonly workspaceID?: Workspace.ID
  readonly accountID?: Account.ID
  readonly actions?: ReadonlyArray<Action>
  readonly from?: Date
  readonly to?: Date
  readonly target?: string
  readonly cursor?: string
  readonly limit?: number
}

/** Installation security record authority. */
export interface Interface {
  /**
   * Append one Entry, joining the caller's active transaction (fail-closed: a
   * failed append rolls the caller's mutation back) or opening one otherwise.
   * The committed Entry is emitted as one structured stderr line when the host
   * keeps `AUDIT_STDOUT` enabled (the default).
   */
  readonly record: (input: RecordInput) => Effect.Effect<void, StoreError>
  /** Read Entries, newest first, cursor-paginated. Callers filter; the edge authorizes. */
  readonly list: (input?: ListInput) => Effect.Effect<EntryPage, CursorError | StoreError>
  /**
   * Delete Entries older than the host-configured retention (`AUDIT_RETENTION_DAYS`,
   * default 365), emitting a summary stderr line before deleting. The only deleter.
   */
  readonly prune: () => Effect.Effect<{ readonly deleted: number }, StoreError>
}

export interface EntryPage {
  readonly data: ReadonlyArray<Entry>
  readonly cursor?: string
}

/** Process-global Installation security record. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Audit") {}

/**
 * Request network context (client IP and user agent) supplied by the HTTP edge
 * for the duration of one request. Audit reads it only to default
 * `RecordInput.context`; it is never an authorization input.
 */
export const RequestContext = Context.Reference<Audit.Context | undefined>(
  "@bymorning/core/Audit.RequestContext",
  { defaultValue: () => undefined },
)

/** Map an edge-authenticated Actor to its compact Entry principal. */
export const principal = (actor: AccountActor | ActorInfo): Principal => {
  switch (actor.type) {
    case "account":
      return { type: "account", accountID: actor.properties.accountID }
    case "user":
      return {
        type: "user",
        accountID: actor.properties.accountID,
        userID: actor.properties.userID,
        workspaceID: actor.properties.workspaceID,
      }
    case "service_account":
      return {
        type: "service_account",
        workspaceID: actor.properties.workspaceID,
        serviceAccountID: actor.properties.serviceAccountID,
        keyID: actor.properties.keyID,
      }
    case "workspace":
      return { type: "system", workspaceID: actor.properties.workspaceID }
    case "system":
      return { type: "system", workspaceID: actor.properties.workspaceID }
  }
}

/** The compact User principal of the member bound to one retained Workspace graph. */
export const member = (binding: Binding.Value): Principal => ({
  type: "user",
  accountID: binding.accountID,
  userID: binding.userID,
  workspaceID: binding.workspaceID,
})

/** The principal of ByMorning itself, optionally within one Workspace. */
export const system = (workspaceID?: Workspace.ID): Principal => ({
  type: "system",
  ...(workspaceID === undefined ? {} : { workspaceID }),
})

/** The principal of an unauthenticated caller, such as a failed login or Setup completion. */
export const anonymous = (email?: string): Principal => ({
  type: "anonymous",
  ...(email === undefined ? {} : { email }),
})

/** Record one Entry through the process-global service. One-line wiring for mutation sites. */
export const record = (input: RecordInput): Effect.Effect<void, StoreError, Service> =>
  Service.use((audit) => audit.record(input))

/**
 * Run `operation` and append one Entry in the same transaction, so a failed
 * Entry rolls the mutation back. One-line wiring for edge call sites; pass a
 * function to shape the Entry from the operation's result.
 */
export const audited = <A, E, R>(
  operation: Effect.Effect<A, E, R>,
  input: RecordInput | ReadonlyArray<RecordInput> | ((value: A) => RecordInput | ReadonlyArray<RecordInput>),
) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const audit = yield* Service
    return yield* database.transact(
      Effect.gen(function* () {
        const value = yield* operation
        const resolved = typeof input === "function" ? input(value) : input
        yield* Effect.forEach(Array.isArray(resolved) ? resolved : [resolved], (entry) => audit.record(entry), {
          discard: true,
        })
        return value
      }),
    )
  })

const accountOf = (actor: Principal): Account.ID | null =>
  actor.type === "account" || actor.type === "user" ? actor.accountID : null

const workspaceOf = (actor: Principal): Workspace.ID | undefined =>
  "workspaceID" in actor ? actor.workspaceID : undefined

interface RowShape {
  readonly id: ID
  readonly sequence: number
  readonly occurredAt: Date
  readonly actor: Principal
  readonly action: Action
  readonly workspaceId: Workspace.ID | null
  readonly target: string | null
  readonly detail: Record<string, unknown> | null
  readonly outcome: Outcome
  readonly ip: string | null
  readonly user_agent: string | null
  readonly chain: string
}

const toEntry = (row: RowShape): Entry => ({
  id: row.id,
  sequence: row.sequence,
  occurredAt: row.occurredAt,
  actor: row.actor,
  action: row.action,
  ...(row.workspaceId === null ? {} : { workspaceID: row.workspaceId }),
  ...(row.target === null ? {} : { target: row.target }),
  ...(row.detail === null ? {} : { detail: row.detail }),
  outcome: row.outcome,
  ...(row.ip === null && row.user_agent === null
    ? {}
    : {
        context: {
          ...(row.ip === null ? {} : { ip: row.ip }),
          ...(row.user_agent === null ? {} : { userAgent: row.user_agent }),
        },
      }),
  chain: row.chain,
})

const Cursor = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literal("audit-entry"),
  sequence: Schema.Number,
  workspaceID: Schema.NullOr(Schema.String),
  accountID: Schema.NullOr(Schema.String),
})

const encodeCursor = (cursor: typeof Cursor.Type) => Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")

/** PostgreSQL-backed Audit implementation with a serialized tamper-evident append. */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    // Malformed host configuration fails boot loudly rather than silently weakening retention or export.
    const retentionDays = yield* Config.schema(Schema.Int.check(Schema.isGreaterThan(0)), "AUDIT_RETENTION_DAYS").pipe(
      Config.withDefault(365),
      Effect.orDie,
    )
    const stdout = yield* Config.boolean("AUDIT_STDOUT").pipe(Config.withDefault(true), Effect.orDie)
    const store = make(database)

    const record = Effect.fn("Audit.record")(function* (input: RecordInput) {
      const fallback = yield* RequestContext
      const context = input.context ?? fallback
      const entry = yield* database
        .transact(
          Effect.gen(function* () {
            yield* store.lock
            const previous = (yield* store.lastChain)[0]?.chain ?? null
            const id = Audit.ID.create()
            const occurredAt = yield* DateTime.nowAsDate
            const workspaceID = input.workspaceID ?? workspaceOf(input.actor) ?? null
            // Store the canonical JSON form of the covered content so the
            // persisted row and its digest never drift apart.
            const actor = normalize(input.actor)
            const detail = input.detail === undefined ? null : normalize(input.detail)
            const covered = {
              id,
              occurredAt: occurredAt.toISOString(),
              actor,
              action: input.action,
              workspaceID,
              target: input.target ?? null,
              detail,
              outcome: input.outcome,
              context:
                context === undefined || (context.ip === undefined && context.userAgent === undefined)
                  ? null
                  : normalize(context),
            }
            const chained = digest(previous, covered)
            const rows = yield* store.insert({
              id,
              occurredAt,
              actor,
              accountId: accountOf(input.actor),
              workspaceId: workspaceID,
              action: input.action,
              target: covered.target,
              detail,
              outcome: input.outcome,
              ip: covered.context?.ip ?? null,
              user_agent: covered.context?.userAgent ?? null,
              chain: chained,
            })
            const sequence = rows[0]?.sequence
            if (sequence === undefined) return yield* Effect.die(new Error("Audit insert returned no row"))
            return toEntry({
              id,
              sequence,
              occurredAt,
              actor,
              action: input.action,
              workspaceId: workspaceID,
              target: covered.target,
              detail,
              outcome: input.outcome,
              ip: covered.context?.ip ?? null,
              user_agent: covered.context?.userAgent ?? null,
              chain: chained,
            })
          }),
        )
        .pipe(Effect.mapError((cause) => new StoreError({ cause })))
      if (stdout) yield* database.afterCommit(writeEntry(entry))
    })

    const list = Effect.fn("Audit.list")(function* (input: ListInput = {}) {
      const cursor =
        input.cursor === undefined
          ? undefined
          : yield* Effect.try(() => JSON.parse(Buffer.from(input.cursor!, "base64url").toString("utf8"))).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Cursor)),
              Effect.filterOrFail(
                (decoded) =>
                  decoded.workspaceID === (input.workspaceID ?? null) &&
                  decoded.accountID === (input.accountID ?? null),
                () => new CursorError(),
              ),
              Effect.mapError(() => new CursorError()),
            )
      const requested = input.limit ?? 50
      const limit = Number.isFinite(requested) ? Math.min(100, Math.max(1, Math.trunc(requested))) : 50
      const rows = yield* store
        .page({
          ...(input.workspaceID === undefined ? {} : { workspaceID: input.workspaceID }),
          ...(input.accountID === undefined ? {} : { accountID: input.accountID }),
          ...(input.actions === undefined ? {} : { actions: input.actions }),
          ...(input.from === undefined ? {} : { from: input.from }),
          ...(input.to === undefined ? {} : { to: input.to }),
          ...(input.target === undefined ? {} : { target: input.target }),
          ...(cursor === undefined ? {} : { before: cursor.sequence }),
          limit,
        })
        .pipe(Effect.mapError((cause) => new StoreError({ cause })))
      const selected = rows.slice(0, limit)
      const data = selected.map(toEntry)
      const last = selected.at(-1)
      if (rows.length <= limit || last === undefined) return { data }
      return {
        data,
        cursor: encodeCursor({
          version: 1,
          kind: "audit-entry",
          sequence: last.sequence,
          workspaceID: input.workspaceID ?? null,
          accountID: input.accountID ?? null,
        }),
      }
    })

    const prune = Effect.fn("Audit.prune")(function* () {
      return yield* run(database, store, retentionDays, (cause) => new StoreError({ cause }))
    })

    return Service.of({ record, list, prune })
  }),
)

/** Process-global Audit node with host-selected Database wiring. */
export const makeNode = <E>(deps: { readonly database: GlobalNode<Database.Service, E> }) =>
  makeGlobalNode({ service: Service, layer, deps: [deps.database] })

/** Host-selected process-global Audit node. */
export const node = LayerNode.unbound<Service, Interface, typeof tags.values.global, unknown>(
  Service,
  tags.values.global,
)

/** Canonical Audit recorder node: records the Share Tool lifecycle for the bound member. */
export const recorder = makeWorkspaceNode({
  name: "@bymorning/core/Audit.recorder",
  layer: Layer.unwrap(
    Effect.gen(function* () {
      const binding = yield* Binding.Service
      const audit = yield* Service
      return recorderLayer(audit, member(binding), binding.workspaceID)
    }),
  ),
  deps: [Binding.node, node, PluginHooks.node],
})
