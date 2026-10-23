import type { GlobalNode } from "@bymorning/util/effect/app-node"
export * as Usage from "./usage.js"

import { Assistant } from "@bymorning/schema/message"
import { MessageID } from "@bymorning/schema/identifier"
import { Auth } from "@bymorning/schema/auth"
import { Aggregate, ID, Info, Leaderboard, Overview, Record } from "@bymorning/schema/usage"
import type { Days, Tokens } from "@bymorning/schema/usage"
import type { Model as ModelSchema } from "@bymorning/schema/model"
import { Model } from "./model.js"
import type { Principal } from "@bymorning/schema/usage"
import { Workspace } from "@bymorning/schema/workspace"
import { and, asc, desc, eq, gt, gte, lt, lte, or, sql } from "drizzle-orm"
import { Array, Context, Crypto, DateTime, Effect, Layer, Option, Schema, Stream } from "effect"
import {
  AccountTable,
  AuthTable,
  Database,
  SessionMessageTable,
  SessionTable,
  UsageTable,
  UserTable,
} from "./database.js"
import { Provider } from "./provider.js"
import { normalize } from "./session/usage.js"
import { maximumCost } from "./session/usage.js"
import { makeWorkspaceNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"
import { LayerNodePlatform } from "@bymorning/util/effect/app-node-platform"
import { Actor } from "./actor.js"
import { Budget } from "./budget.js"
import { PluginHooks } from "./plugin/hooks.js"
import type { ModelError } from "@bymorning/schema/plugin-model"
import { User } from "./user.js"
import { AccountActor } from "@bymorning/schema/actor"
/** A pagination cursor is malformed. */
export class InvalidCursorError extends Schema.TaggedError<InvalidCursorError>()("Usage.InvalidCursorError", {}) {}

/** Usage persistence failed. */
export class StoreError extends Schema.TaggedError<StoreError>()("Usage.StoreError", {
  operation: Schema.Literals(["record", "spend"]),
  cause: Schema.Defect(),
}) {}

/** One observed LLM Gateway invocation, attributed to the caller principal derived at the edge. */
export interface RecordInput {
  readonly requestID: string
  readonly model: string
  readonly endpointID: string
  readonly upstreamModel: string
  readonly selection: ModelSchema.Info
  readonly tokens: Tokens
  readonly occurredAt: Date
  /** The User or Service Account the edge authenticated for this invocation. */
  readonly principal: Principal
}

/** Usage interval and optional inference principal filter. */
export interface SpendInput {
  readonly period: { readonly start: Date; readonly end: Date }
  readonly source: "all" | "inference"
  readonly principal?: Principal
}

/** Completed Assistant usage in one Workspace. */
export interface Interface {
  /** Persist one Gateway observation and return its priced cost for settlement. */
  readonly record: (input: RecordInput) => Effect.Effect<{ readonly cost: number }, StoreError>
  readonly spend: (input: SpendInput) => Effect.Effect<number, StoreError>
  readonly list: (input?: {
    readonly cursor?: string
    readonly limit?: number
  }) => Effect.Effect<{ readonly data: ReadonlyArray<Info>; readonly cursor?: string }, InvalidCursorError>
  readonly records: (input?: {
    readonly cursor?: string
    readonly limit?: number
  }) => Effect.Effect<{ readonly data: ReadonlyArray<Record>; readonly cursor?: string }, InvalidCursorError>
  readonly overview: (input: { readonly days: Days }) => Effect.Effect<Overview>
  readonly leaderboard: (input: { readonly days: Days }) => Effect.Effect<Leaderboard>
}

/** Completed Assistant usage in one Workspace. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Usage") {}

/** UTC calendar-month interval containing `date`, with an exclusive upper boundary. */
export const utcMonth = (date: Date) => ({
  start: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)),
  end: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)),
})

/**
 * The most one attempt can cost: the whole context window in and the full
 * output limit out. Models that publish no limits fall back to Budget's nominal hold.
 */
const worstCase = (model: ModelSchema.Info) => {
  const input = model.limit.input ?? model.limit.context
  const output = model.limit.output
  if (input === undefined || output === undefined) return undefined
  return cost(model, { input, output, reasoning: 0, cacheRead: 0, cacheWrite: 0 })
}

const estimateFor = (model: ModelSchema.Info) => {
  const estimate = worstCase(model)
  return estimate === undefined ? undefined : { estimate }
}

const cost = (model: ModelSchema.Info, tokens: Tokens) => {
  const context = tokens.input + tokens.cacheRead + tokens.cacheWrite
  const selected =
    model.cost.tiers
      ?.filter((item) => context > item.tier.size)
      .toSorted((left, right) => right.tier.size - left.tier.size)[0] ??
    (model.cost.experimentalOver200K !== undefined && context > 200_000 ? model.cost.experimentalOver200K : model.cost)
  const estimate =
    tokens.input * (selected.input ?? 0) +
    (tokens.output + tokens.reasoning) * (selected.output ?? 0) +
    tokens.cacheRead * (selected.cache.read ?? 0) +
    tokens.cacheWrite * (selected.cache.write ?? 0)
  return Number.isFinite(estimate) ? Math.min(maximumCost, estimate / 1_000_000) : maximumCost
}

/** Decorate one Workspace Provider boundary with durable usage observation. */
export const providerLayer = Layer.effect(
  Provider.Service,
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const database = yield* Database.Service
    const crypto = yield* Crypto.Crypto
    return Provider.Service.of({
      get: provider.get,
      list: provider.list,
      stream: (input) =>
        provider.stream(input).pipe(
          Stream.tap((event) => {
            if (event.type !== "step-finish") return Effect.void
            const usage = normalize(event.usage, input.selection.info.cost)
            return Effect.gen(function* () {
              const id = yield* crypto.randomUUIDv4.pipe(Effect.flatMap(Schema.decodeUnknownEffect(ID)))
              yield* database.use("Usage.recordSession", (db) =>
                Effect.gen(function* () {
                  const session = (yield* db
                    .select({ workspaceID: SessionTable.workspaceID, userID: SessionTable.userID })
                    .from(SessionTable)
                    .where(eq(SessionTable.id, input.context.sessionID))
                    .limit(1))[0]
                  if (session === undefined) return yield* Effect.die(new Error("Usage Session missing"))
                  yield* db.insert(UsageTable).values({
                    id,
                    workspaceID: session.workspaceID,
                    userID: session.userID,
                    sessionID: input.context.sessionID,
                    source: "session",
                    model: input.context.model.id,
                    input: usage.tokens.input,
                    output: usage.tokens.output,
                    reasoning: usage.tokens.reasoning,
                    cacheRead: usage.tokens.cache.read,
                    cacheWrite: usage.tokens.cache.write,
                    cost: usage.cost.toString(),
                    costComplete: usage.costComplete,
                    occurredAt: new Date(),
                  })
                }),
              )
            }).pipe(Effect.orDie)
          }),
        ),
    })
  }),
)

/** Session-only Provider decorator: admits and accounts for one physical inference attempt. */
export const sessionProviderLayer = Layer.effect(
  Provider.Service,
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const database = yield* Database.Service
    const crypto = yield* Crypto.Crypto
    const hooks = yield* PluginHooks.Service
    const users = yield* User.Service
    const binding = yield* Actor.Binding.Service
    const budget = yield* Budget.Service
    return Provider.Service.of({
      get: provider.get,
      list: provider.list,
      stream: (input) =>
        Stream.scoped(
          Stream.unwrap(
            Effect.gen(function* () {
              // A retained member binding is construction data, not an Actor.
              // Reload the membership so a role change or revoked membership is
              // never represented by a fabricated UserActor.
              const actor = yield* users
                .select({
                  account: new AccountActor({ type: "account", properties: { accountID: binding.accountID } }),
                  workspaceID: binding.workspaceID,
                })
                .pipe(
                  Effect.filterOrFail(
                    (current) => current.properties.userID === binding.userID,
                    () => new User.AccessError({ reason: "membership-unavailable" }),
                  ),
                  Effect.mapError(
                    () =>
                      new Provider.FailureError({
                        cause: "Session membership unavailable",
                        message: "Session membership unavailable",
                        category: "auth",
                      }),
                  ),
                )
              const requestID = yield* crypto.randomUUIDv4.pipe(
                Effect.mapError(
                  () => new Provider.FailureError({ cause: "Request ID unavailable", category: "internal" }),
                ),
              )
              // Session is an inference entrypoint: reserve for the Workspace and this
              // member before any Plugin admission or Provider call. The reservation
              // lives in the Stream Scope and is released if usage is never observed.
              const reservation = yield* budget
                .reserve(Actor.holders(actor), { estimate: worstCase(input.selection.info) })
                .pipe(
                  Effect.mapError((error) =>
                    error._tag === "Budget.ExceededError"
                      ? new Provider.FailureError({
                          cause: `Spend limit exceeded: ${error.holder}`,
                          message:
                            "Workspace budget reached: the spend limit has no room left this period. Ask a Workspace admin to raise it.",
                          category: "quota",
                        })
                      : new Provider.FailureError({
                          cause: "Budget persistence unavailable",
                          message: "Budget persistence unavailable",
                          category: "internal",
                        }),
                  ),
                )
              const invocation = yield* hooks
                .open({
                  domain: "session",
                  event: Object.freeze({
                    id: requestID,
                    workspaceID: actor.properties.workspaceID,
                    sessionID: input.context.sessionID,
                    ...(input.context.messageID === undefined ? {} : { messageID: input.context.messageID }),
                    agent: input.context.agent,
                    purpose: input.context.purpose,
                    model: Object.freeze({ provider: input.selection.info.provider, id: input.selection.info.id }),
                    publicModel: Model.publicID(input.selection.info),
                    stream: true,
                  }),
                })
                .pipe(Effect.mapError(modelFailure))
              let observed = false
              return provider.stream(input).pipe(
                Stream.tap((event) => {
                  if (event.type !== "step-finish") return Effect.void
                  // @opencode-ai/ai emits exactly one step-finish per physical model
                  // call. Record first, then settle with the same normalized tokens.
                  // A second event is provider corruption rather than a second call.
                  if (observed) return Effect.void
                  observed = true
                  const usage = normalize(event.usage, input.selection.info.cost)
                  return Effect.gen(function* () {
                    const id = yield* Schema.decodeUnknownEffect(ID)(requestID).pipe(
                      Effect.mapError(
                        () => new Provider.FailureError({ cause: "Usage ID unavailable", category: "internal" }),
                      ),
                    )
                    yield* database
                      .use("Usage.recordSession", (db) =>
                        Effect.gen(function* () {
                          const session = (yield* db
                            .select({ workspaceID: SessionTable.workspaceID, userID: SessionTable.userID })
                            .from(SessionTable)
                            .where(eq(SessionTable.id, input.context.sessionID))
                            .limit(1))[0]
                          if (
                            session === undefined ||
                            session.workspaceID !== actor.properties.workspaceID ||
                            session.userID !== actor.properties.userID
                          )
                            return yield* new StoreError({ operation: "record", cause: "Usage Session unavailable" })
                          yield* db.insert(UsageTable).values({
                            id,
                            workspaceID: session.workspaceID,
                            userID: session.userID,
                            sessionID: input.context.sessionID,
                            source: "session",
                            request_id: requestID,
                            model: input.context.model.id,
                            input: usage.tokens.input,
                            output: usage.tokens.output,
                            reasoning: usage.tokens.reasoning,
                            cacheRead: usage.tokens.cache.read,
                            cacheWrite: usage.tokens.cache.write,
                            cost: usage.cost.toString(),
                            costComplete: usage.costComplete,
                            occurredAt: new Date(),
                          })
                        }),
                      )
                      .pipe(
                        Effect.mapError(
                          () =>
                            new Provider.FailureError({
                              cause: "Usage persistence unavailable",
                              message: "Usage persistence unavailable",
                              category: "internal",
                              requestID,
                            }),
                        ),
                      )
                    yield* reservation.settle(usage.cost).pipe(
                      Effect.mapError(
                        () =>
                          new Provider.FailureError({
                            cause: "Budget persistence unavailable",
                            message: "Budget persistence unavailable",
                            category: "internal",
                            requestID,
                          }),
                      ),
                    )
                    yield* invocation
                      .usage(
                        Object.freeze({
                          input: usage.tokens.input,
                          output: usage.tokens.output,
                          reasoning: usage.tokens.reasoning,
                          cacheRead: usage.tokens.cache.read,
                          cacheWrite: usage.tokens.cache.write,
                        }),
                      )
                      .pipe(Effect.mapError(modelFailure))
                  })
                }),
              )
            }),
          ),
        ),
    })
  }),
)

const modelFailure = (error: ModelError) =>
  new Provider.FailureError({
    cause: error._tag,
    message: "Session inference refused or unavailable",
    category:
      error.reason === "budget"
        ? "quota"
        : error.reason === "rate"
          ? "rate-limit"
          : error.reason === "denied" || error.reason === "model"
            ? "content-filter"
            : "internal",
  })

const ListCursor = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literal("usage"),
  createdAt: Schema.DateFromString,
  id: MessageID,
})

const RecordCursor = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literal("usage-record"),
  createdAt: Schema.DateFromString,
  id: ID,
})

/** PostgreSQL-backed Usage for one Workspace. */
export const layer = (workspaceID: Workspace.ID) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const database = yield* Database.Service
      const crypto = yield* Crypto.Crypto
      return Service.of({
        record: Effect.fn("Usage.record")(
          function* (input) {
            const id = yield* crypto.randomUUIDv4.pipe(Effect.flatMap(Schema.decodeUnknownEffect(ID)))
            const priced = cost(input.selection, input.tokens)
            yield* database.use("Usage.record", (db) =>
              db.insert(UsageTable).values({
                id,
                workspaceID,
                source: "inference",
                userID: input.principal.type === "user" ? input.principal.userID : null,
                serviceAccountID: input.principal.type === "service_account" ? input.principal.serviceAccountID : null,
                request_id: input.requestID,
                model: input.model,
                endpoint_id: input.endpointID,
                upstream_model: input.upstreamModel,
                input: input.tokens.input,
                output: input.tokens.output,
                reasoning: input.tokens.reasoning,
                cacheRead: input.tokens.cacheRead,
                cacheWrite: input.tokens.cacheWrite,
                cost: priced.toString(),
                occurredAt: input.occurredAt,
              }),
            )
            return { cost: priced }
          },
          Effect.mapError((cause) => new StoreError({ operation: "record", cause })),
        ),
        spend: Effect.fn("Usage.spend")(function* (input) {
          const rows = yield* database
            .use("Usage.spend", (db) =>
              db
                .select({ total: sql<string>`coalesce(sum(${UsageTable.cost}), 0)` })
                .from(UsageTable)
                .where(
                  and(
                    eq(UsageTable.workspaceID, workspaceID),
                    input.source === "inference" ? eq(UsageTable.source, "inference") : undefined,
                    gte(UsageTable.occurredAt, input.period.start),
                    lt(UsageTable.occurredAt, input.period.end),
                    input.principal?.type === "user"
                      ? eq(UsageTable.userID, input.principal.userID)
                      : input.principal?.type === "service_account"
                        ? eq(UsageTable.serviceAccountID, input.principal.serviceAccountID)
                        : undefined,
                  ),
                ),
            )
            .pipe(Effect.mapError((cause) => new StoreError({ operation: "spend", cause })))
          return Number(rows[0]?.total ?? 0)
        }),
        list: Effect.fn("Usage.list")(function* (input = {}) {
          const cursor =
            input.cursor === undefined
              ? undefined
              : yield* Effect.try(() => JSON.parse(Buffer.from(input.cursor!, "base64url").toString("utf8"))).pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(ListCursor)),
                  Effect.mapError(() => new InvalidCursorError()),
                )
          const limit = input.limit ?? 50
          const rows = yield* database.use("usageList", (db) =>
            db
              .select({
                id: SessionMessageTable.id,
                data: SessionMessageTable.data,
                createdAt: SessionMessageTable.timeCreated,
              })
              .from(SessionMessageTable)
              .innerJoin(SessionTable, eq(SessionTable.id, SessionMessageTable.sessionID))
              .where(
                and(
                  eq(SessionTable.workspaceID, workspaceID),
                  eq(SessionMessageTable.type, "assistant"),
                  sql`${SessionMessageTable.data}->'time' ? 'completed'`,
                  sql`${SessionMessageTable.data} ? 'usage'`,
                  cursor === undefined
                    ? undefined
                    : or(
                        lt(SessionMessageTable.timeCreated, cursor.createdAt),
                        and(
                          eq(SessionMessageTable.timeCreated, cursor.createdAt),
                          gt(SessionMessageTable.id, cursor.id),
                        ),
                      ),
                ),
              )
              .orderBy(desc(SessionMessageTable.timeCreated), asc(SessionMessageTable.id))
              .limit(limit + 1)
              .pipe(Effect.orDie),
          )
          const selected = rows.slice(0, limit)
          const data = yield* Effect.forEach(selected, (row) =>
            Schema.decodeUnknownEffect(Assistant)(row.data).pipe(
              Effect.map((message) =>
                Info.make({
                  id: message.id,
                  sessionID: message.sessionID,
                  model: message.model,
                  createdAt: message.createdAt,
                  usage: message.usage,
                }),
              ),
              Effect.orDie,
            ),
          )
          const next = Array.last(selected).pipe(
            Option.filter(() => rows.length > limit),
            Option.map((last) => ({
              cursor: Buffer.from(
                JSON.stringify({
                  version: 1,
                  kind: "usage",
                  createdAt: last.createdAt.toISOString(),
                  id: last.id,
                }),
              ).toString("base64url"),
            })),
            Option.getOrElse(() => ({})),
          )
          return { data, ...next }
        }),
        records: Effect.fn("Usage.records")(function* (input = {}) {
          const cursor =
            input.cursor === undefined
              ? undefined
              : yield* Effect.try(() => JSON.parse(Buffer.from(input.cursor!, "base64url").toString("utf8"))).pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(RecordCursor)),
                  Effect.mapError(() => new InvalidCursorError()),
                )
          const limit = input.limit ?? 50
          const rows = yield* database.use("usageRecords", (db) =>
            db
              .select()
              .from(UsageTable)
              .where(
                and(
                  eq(UsageTable.workspaceID, workspaceID),
                  cursor === undefined
                    ? undefined
                    : or(
                        lt(UsageTable.occurredAt, cursor.createdAt),
                        and(eq(UsageTable.occurredAt, cursor.createdAt), gt(UsageTable.id, cursor.id)),
                      ),
                ),
              )
              .orderBy(desc(UsageTable.occurredAt), asc(UsageTable.id))
              .limit(limit + 1)
              .pipe(Effect.orDie),
          )
          const selected = rows.slice(0, limit)
          const data = selected.map((row) =>
            Record.make({
              id: row.id,
              model: row.model,
              createdAt: row.occurredAt,
              ...(row.userID !== null
                ? { principal: { type: "user" as const, userID: row.userID } }
                : row.serviceAccountID !== null
                  ? { principal: { type: "service_account" as const, serviceAccountID: row.serviceAccountID } }
                  : {}),
              source: row.source,
              ...(row.request_id === null ? {} : { requestID: row.request_id }),
              ...(row.endpoint_id === null ? {} : { endpointID: row.endpoint_id }),
              ...(row.upstream_model === null ? {} : { upstreamModel: row.upstream_model }),
              usage: {
                cost: Number(row.cost),
                costComplete: row.costComplete,
                tokens: {
                  input: row.input,
                  output: row.output,
                  reasoning: row.reasoning,
                  cache: { read: row.cacheRead, write: row.cacheWrite },
                },
              },
            }),
          )
          const next = Array.last(selected).pipe(
            Option.filter(() => rows.length > limit),
            Option.map((last) => ({
              cursor: Buffer.from(
                JSON.stringify({
                  version: 1,
                  kind: "usage-record",
                  createdAt: last.occurredAt.toISOString(),
                  id: last.id,
                }),
              ).toString("base64url"),
            })),
            Option.getOrElse(() => ({})),
          )
          return { data, ...next }
        }),
        overview: Effect.fn("Usage.overview")(function* ({ days }) {
          const to = yield* DateTime.nowAsDate
          const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() - (days - 1)))
          const rows = yield* database
            .use("usageOverview", (db) =>
              db
                .select()
                .from(UsageTable)
                .where(
                  and(
                    eq(UsageTable.workspaceID, workspaceID),
                    gte(UsageTable.occurredAt, from),
                    lte(UsageTable.occurredAt, to),
                  ),
                ),
            )
            .pipe(Effect.orDie)
          const aggregate = (selected: typeof rows): Aggregate => {
            const input = selected.reduce((total, row) => total + row.input, 0)
            const output = selected.reduce((total, row) => total + row.output, 0)
            const reasoning = selected.reduce((total, row) => total + row.reasoning, 0)
            const read = selected.reduce((total, row) => total + row.cacheRead, 0)
            const write = selected.reduce((total, row) => total + row.cacheWrite, 0)
            return Aggregate.make({
              invocations: selected.length,
              cost: selected.reduce((total, row) => total + Number(row.cost), 0),
              costComplete: selected.every((row) => row.costComplete),
              tokens: {
                total: input + output + reasoning + read + write,
                input,
                output,
                reasoning,
                cache: { read, write },
              },
            })
          }
          const groups = <K extends string>(selected: typeof rows, key: (row: (typeof rows)[number]) => K) =>
            Map.groupBy(selected, key)
              .entries()
              .map(([value, selected]) => ({ key: value, usage: aggregate(selected) }))
              .toArray()
              .toSorted(
                (left, right) => right.usage.invocations - left.usage.invocations || left.key.localeCompare(right.key),
              )
          const daily = Array.makeBy(days, (index) => {
            const date = new Date(from)
            date.setUTCDate(date.getUTCDate() + index)
            const key = date.toISOString().slice(0, 10)
            return {
              date: key,
              usage: aggregate(rows.filter((row) => row.occurredAt.toISOString().slice(0, 10) === key)),
            }
          })
          return Overview.make({
            days,
            from,
            to,
            total: aggregate(rows),
            daily,
            users: groups(
              rows.filter((row) => row.userID !== null),
              (row) => row.userID!,
            ).map(({ key, usage }) => ({ userID: key, usage })),
            models: groups(rows, (row) => row.model).map(({ key, usage }) => ({ model: key, usage })),
          })
        }),
        leaderboard: Effect.fn("Usage.leaderboard")(function* ({ days }) {
          const to = yield* DateTime.nowAsDate
          const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() - (days - 1)))
          const rows = yield* database
            .use("usageLeaderboard", (db) =>
              db
                .select({
                  userID: UsageTable.userID,
                  email: sql<Auth.Email>`coalesce(${UserTable.email}, ${AccountTable.email}, (
                      select ${AuthTable.subject}
                      from ${AuthTable}
                      where ${AuthTable.accountId} = ${UserTable.accountId}
                        and ${AuthTable.provider} = ${Auth.Provider.make("email")}
                        and ${AuthTable.timeDeleted} is null
                      order by ${AuthTable.timeCreated}, ${AuthTable.id}
                      limit 1
                    ))`,
                  model: UsageTable.model,
                  input: UsageTable.input,
                  output: UsageTable.output,
                  reasoning: UsageTable.reasoning,
                  cacheRead: UsageTable.cacheRead,
                  cacheWrite: UsageTable.cacheWrite,
                  cost: UsageTable.cost,
                  costComplete: UsageTable.costComplete,
                })
                .from(UsageTable)
                .leftJoin(
                  UserTable,
                  and(eq(UserTable.workspaceId, UsageTable.workspaceID), eq(UserTable.id, UsageTable.userID)),
                )
                .leftJoin(AccountTable, eq(AccountTable.id, UserTable.accountId))
                .where(
                  and(
                    eq(UsageTable.workspaceID, workspaceID),
                    gte(UsageTable.occurredAt, from),
                    lte(UsageTable.occurredAt, to),
                  ),
                ),
            )
            .pipe(Effect.orDie)
          const aggregate = (selected: typeof rows): Aggregate => {
            const input = selected.reduce((total, row) => total + row.input, 0)
            const output = selected.reduce((total, row) => total + row.output, 0)
            const reasoning = selected.reduce((total, row) => total + row.reasoning, 0)
            const read = selected.reduce((total, row) => total + row.cacheRead, 0)
            const write = selected.reduce((total, row) => total + row.cacheWrite, 0)
            return Aggregate.make({
              invocations: selected.length,
              cost: selected.reduce((total, row) => total + Number(row.cost), 0),
              costComplete: selected.every((row) => row.costComplete),
              tokens: {
                total: input + output + reasoning + read + write,
                input,
                output,
                reasoning,
                cache: { read, write },
              },
            })
          }
          const byModel = Map.groupBy(rows, (row) => row.model)
          const users = Map.groupBy(
            rows.filter((row) => row.userID !== null),
            (row) => row.userID!,
          )
            .entries()
            .map(([userID, selected]) => {
              const email = selected.find((row) => row.email !== null)?.email
              return {
                userID,
                ...(email === null || email === undefined ? {} : { email }),
                usage: aggregate(selected),
                models: Map.groupBy(selected, (row) => row.model)
                  .entries()
                  .map(([model, modelRows]) => ({ model, usage: aggregate(modelRows) }))
                  .toArray()
                  .toSorted(
                    (left, right) => right.usage.cost - left.usage.cost || left.model.localeCompare(right.model),
                  ),
              }
            })
            .toArray()
            .toSorted((left, right) => right.usage.cost - left.usage.cost || left.userID.localeCompare(right.userID))
          return Leaderboard.make({
            days,
            from,
            to,
            users,
            models: byModel
              .entries()
              .map(([model, selected]) => ({
                model,
                users: new Set(selected.flatMap((row) => (row.userID === null ? [] : [row.userID]))).size,
                usage: aggregate(selected),
              }))
              .toArray()
              .toSorted((left, right) => right.usage.cost - left.usage.cost || left.model.localeCompare(right.model)),
          })
        }),
      })
    }),
  )

/** Canonical Usage query node for one Workspace. */
export const workspaceNodes = <E>(workspaceID: Workspace.ID, database?: GlobalNode<Database.Service, E>) =>
  makeWorkspaceNode({
    service: Service,
    layer: layer(workspaceID),
    deps: [database ?? Database.node, LayerNodePlatform.crypto],
  })

export const node = makeWorkspaceNode({
  service: Service,
  layer: Layer.unwrap(Effect.map(Actor.Binding.Service, ({ workspaceID }) => layer(workspaceID))),
  deps: [Actor.binding, Database.node, LayerNodePlatform.crypto],
})
