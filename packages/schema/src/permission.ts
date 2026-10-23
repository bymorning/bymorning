/** Declares the Permission contract owned by this module. */
export * as Permission from "./permission.js"
export * as PermissionSchema from "./permission.js"

import { Schema } from "effect"
import { AgentID } from "./agent-id.js"
import { MessageID, SessionID, ascending } from "./identifier.js"
import { optional, statics } from "./schema.js"
import { ID as UserID } from "./user.js"

/** Pending Permission request identity. */
export const ID = Schema.String.check(Schema.isStartsWith("per")).pipe(
  Schema.brand("Permission.ID"),
  statics((schema) => ({ create: (id?: string) => schema.make(id ?? "per_" + ascending()) })),
)
/** Pending Permission request identity. */
export type ID = typeof ID.Type

/** Durable saved Permission identity. */
export const SavedID = Schema.String.check(Schema.isStartsWith("psv_")).pipe(
  Schema.brand("Permission.SavedID"),
  statics((schema) => ({ create: () => schema.make("psv_" + ascending()) })),
)
/** Durable saved Permission identity. */
export type SavedID = typeof SavedID.Type

/** Declares the Effect contract owned by this module. */
export const Effect = Schema.Literals(["allow", "deny", "ask"]).annotate({ identifier: "Permission.Effect" })
/** Declares the Effect contract owned by this module. */
export type Effect = typeof Effect.Type

/** Declares the Rule contract owned by this module. */
export interface Rule extends Schema.Schema.Type<typeof Rule> {}
/** Declares the Rule contract owned by this module. */
export const Rule = Schema.Struct({
  action: Schema.String,
  resource: Schema.String,
  effect: Effect,
  user: UserID.pipe(optional),
}).annotate({ identifier: "Permission.Rule" })

/** Declares the Ruleset contract owned by this module. */
export const Ruleset = Schema.Array(Rule).annotate({ identifier: "Permission.Ruleset" })
/** Declares the Ruleset contract owned by this module. */
export type Ruleset = typeof Ruleset.Type

/** Tool call that originated a Permission request. */
export const Source = Schema.Struct({ type: Schema.Literal("tool"), messageID: MessageID, callID: Schema.String })
/** Tool call that originated a Permission request. */
export interface Source extends Schema.Schema.Type<typeof Source> {}

const requestFields = {
  sessionID: SessionID,
  action: Schema.String,
  resources: Schema.Array(Schema.String),
  save: Schema.Array(Schema.String).pipe(optional),
  metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(optional),
  source: Source.pipe(optional),
}

/** One pending Permission request. */
export const Request = Schema.Struct({ id: ID, ...requestFields })
/** One pending Permission request. */
export interface Request extends Schema.Schema.Type<typeof Request> {}

/** Input used to evaluate or await Permission. */
export const AssertInput = Schema.Struct({ id: ID.pipe(optional), ...requestFields, agent: AgentID.pipe(optional) })
/** Input used to evaluate or await Permission. */
export interface AssertInput extends Schema.Schema.Type<typeof AssertInput> {}

/** A Permission request identity and immediate configured effect. */
export const AskResult = Schema.Struct({ id: ID, effect: Effect })
/** A Permission request identity and immediate configured effect. */
export interface AskResult extends Schema.Schema.Type<typeof AskResult> {}

/** Session-scoped identity of one pending request. */
export const RequestInput = Schema.Struct({ sessionID: SessionID, requestID: ID })
/** Session-scoped identity of one pending request. */
export interface RequestInput extends Schema.Schema.Type<typeof RequestInput> {}

/** Supported replies to pending Permission requests. */
export const Reply = Schema.Literals(["once", "always", "reject"])
/** Supported replies to pending Permission requests. */
export type Reply = typeof Reply.Type

/** Reply to one Session-owned pending request. */
export const ReplyInput = Schema.Struct({
  ...RequestInput.fields,
  reply: Reply,
  message: Schema.String.pipe(optional),
})
/** Reply to one Session-owned pending request. */
export interface ReplyInput extends Schema.Schema.Type<typeof ReplyInput> {}

/** A durable saved allow grant. */
export const Saved = Schema.Struct({ id: SavedID, action: Schema.String, resource: Schema.String })
/** A durable saved allow grant. */
export interface Saved extends Schema.Schema.Type<typeof Saved> {}
