import { Effect, Schema } from "effect"
import { MessageID, SessionID } from "./identifier.js"
import * as Auth from "./auth.js"
import * as Model from "./model.js"
import { NonNegativeInt, Timestamp } from "./schema.js"
import * as ServiceAccount from "./service-account.js"
import * as User from "./user.js"

const Amount = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/** Provider-observed token counts for one completed inference. */
export const Tokens = Schema.Struct({
  input: NonNegativeInt,
  output: NonNegativeInt,
  reasoning: NonNegativeInt,
  cacheRead: NonNegativeInt,
  cacheWrite: NonNegativeInt,
})
/** Provider-observed token counts for one completed inference. */
export interface Tokens extends Schema.Schema.Type<typeof Tokens> {}

export const Principal = Schema.Union([
  Schema.Struct({ type: Schema.Literal("user"), userID: User.ID }),
  Schema.Struct({ type: Schema.Literal("service_account"), serviceAccountID: ServiceAccount.ID }),
])
export type Principal = typeof Principal.Type

export const Source = Schema.Literals(["session", "inference"])
export type Source = typeof Source.Type

/** Token counts and execution-time estimated USD cost attributed to completed Steps. */
export const Usage = Schema.Struct({
  cost: Amount,
  costComplete: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
  tokens: Schema.Struct({
    total: Schema.optionalKey(Amount),
    input: Amount,
    output: Amount,
    reasoning: Amount,
    cache: Schema.Struct({ read: Amount, write: Amount }),
  }),
})

/** Token counts and execution-time estimated USD cost attributed to completed Steps. */
export interface Usage extends Schema.Schema.Type<typeof Usage> {}

/** Usage attributed to one completed Assistant execution. */
export const Info = Schema.Struct({
  id: MessageID,
  sessionID: Schema.optionalKey(SessionID),
  model: Model.Ref,
  createdAt: Timestamp,
  usage: Usage,
  principal: Schema.optionalKey(Principal),
  source: Schema.optionalKey(Source),
  requestID: Schema.optionalKey(Schema.String),
  endpointID: Schema.optionalKey(Schema.String),
  upstreamModel: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "Usage.Info" })

/** Usage attributed to one completed Assistant execution. */
export interface Info extends Schema.Schema.Type<typeof Info> {}

/** Identifier for one immutable provider usage observation. */
export const ID = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("Usage.ID"))
export type ID = typeof ID.Type

/** One immutable provider usage observation persisted for a Workspace. */
export const Record = Schema.Struct({
  id: ID,
  model: Schema.String,
  createdAt: Timestamp,
  usage: Usage,
  principal: Schema.optionalKey(Principal),
  source: Schema.optionalKey(Source),
  requestID: Schema.optionalKey(Schema.String),
  endpointID: Schema.optionalKey(Schema.String),
  upstreamModel: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "Usage.Record" })

/** One immutable provider usage observation persisted for a Workspace. */
export interface Record extends Schema.Schema.Type<typeof Record> {}

/** Positive number of UTC calendar days included in an overview. */
export const Days = Schema.Int.check(Schema.isGreaterThan(0)).pipe(Schema.brand("Usage.Days"))
export type Days = typeof Days.Type

/** Summed usage with total tokens derived from the five persisted token categories. */
export const Aggregate = Schema.Struct({
  invocations: Amount,
  cost: Amount,
  costComplete: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
  tokens: Schema.Struct({
    total: Amount,
    input: Amount,
    output: Amount,
    reasoning: Amount,
    cache: Schema.Struct({ read: Amount, write: Amount }),
  }),
})

export interface Aggregate extends Schema.Schema.Type<typeof Aggregate> {}

/** Workspace usage totals and UTC calendar buckets for a requested range. */
export const Overview = Schema.Struct({
  days: Days,
  from: Timestamp,
  to: Timestamp,
  total: Aggregate,
  daily: Schema.Array(Schema.Struct({ date: Schema.String, usage: Aggregate })),
  users: Schema.Array(Schema.Struct({ userID: User.ID, usage: Aggregate })),
  models: Schema.Array(Schema.Struct({ model: Schema.String, usage: Aggregate })),
})

export interface Overview extends Schema.Schema.Type<typeof Overview> {}

export const LeaderboardUser = Schema.Struct({
  userID: User.ID,
  email: Schema.optionalKey(Auth.Email),
  usage: Aggregate,
  models: Schema.Array(Schema.Struct({ model: Schema.String, usage: Aggregate })),
})

export interface LeaderboardUser extends Schema.Schema.Type<typeof LeaderboardUser> {}

export const LeaderboardModel = Schema.Struct({
  model: Schema.String,
  users: Amount,
  usage: Aggregate,
})

export interface LeaderboardModel extends Schema.Schema.Type<typeof LeaderboardModel> {}

/** Complete workspace usage rankings for a bounded UTC date range. */
export const Leaderboard = Schema.Struct({
  days: Days,
  from: Timestamp,
  to: Timestamp,
  users: Schema.Array(LeaderboardUser),
  models: Schema.Array(LeaderboardModel),
})

export interface Leaderboard extends Schema.Schema.Type<typeof Leaderboard> {}

/**
 * Context-window tokens occupied after one Assistant execution: the full prompt the provider
 * received (fresh and cached input) plus the output that joins the next prompt.
 *
 * Only meaningful for a single execution. Summed Session usage re-counts replayed history on
 * every request and must not be compared with a context limit.
 */
export const context = (usage: Pick<Usage, "tokens">): number =>
  Math.min(
    Number.MAX_SAFE_INTEGER,
    usage.tokens.input +
      usage.tokens.cache.read +
      usage.tokens.cache.write +
      usage.tokens.output +
      usage.tokens.reasoning,
  )

/** Zero Usage for projections with no completed Step. */
export const empty: Usage = Usage.make({
  cost: 0,
  costComplete: true,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
})
