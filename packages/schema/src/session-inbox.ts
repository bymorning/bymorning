/** Declares durable Session inbox item contracts. */
export * as SessionInbox from "./session-inbox.js"

import { Schema } from "effect"
import { MessageID, SessionID } from "./identifier.js"
import { AgentAttachment } from "./prompt.js"
import { Timestamp } from "./schema.js"

/** Scheduling priority applied when a Session promotes pending input. */
export const Delivery = Schema.Literals(["steer", "queue"]).annotate({ identifier: "Session.Inbox.Delivery" })
/** Scheduling priority applied when a Session promotes pending input. */
export type Delivery = typeof Delivery.Type

/** Model-visible content supplied by a user prompt. */
export const UserPayload = Schema.Struct({
  text: Schema.String,
  agents: Schema.optionalKey(Schema.Array(AgentAttachment)),
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "Session.Inbox.UserPayload" })
/** Model-visible content supplied by a user prompt. */
export interface UserPayload extends Schema.Schema.Type<typeof UserPayload> {}

/** Model-visible synthetic context and client-only presentation metadata. */
export const SyntheticPayload = Schema.Struct({
  text: Schema.String,
  description: Schema.optionalKey(Schema.String),
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
}).annotate({ identifier: "Session.Inbox.SyntheticPayload" })
/** Model-visible synthetic context and client-only presentation metadata. */
export interface SyntheticPayload extends Schema.Schema.Type<typeof SyntheticPayload> {}

/** Empty control payload for a requested conversation compaction. */
export const CompactionPayload = Schema.Struct({}).annotate({ identifier: "Session.Inbox.CompactionPayload" })
/** Empty control payload for a requested conversation compaction. */
export interface CompactionPayload extends Schema.Schema.Type<typeof CompactionPayload> {}

const UserItem = Schema.Struct({ type: Schema.Literal("user"), payload: UserPayload, delivery: Delivery })
const SyntheticItem = Schema.Struct({
  type: Schema.Literal("synthetic"),
  payload: SyntheticPayload,
  delivery: Delivery,
})
const CompactionItem = Schema.Struct({
  type: Schema.Literal("compaction"),
  payload: CompactionPayload,
  delivery: Delivery,
})

/** Pending Session input persisted before transcript promotion. */
export const Item = Schema.Union([UserItem, SyntheticItem, CompactionItem]).pipe(
  Schema.toTaggedUnion("type"),
  Schema.annotate({ identifier: "Session.Inbox.Item" }),
)
/** Pending Session input persisted before transcript promotion. */
export type Item = typeof Item.Type

const InfoBase = {
  id: MessageID,
  sessionID: SessionID,
  admittedSequence: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
  createdAt: Timestamp,
}
/** Admitted synthetic input returned by the Session operation. */
export const Synthetic = Schema.Struct({
  id: MessageID,
  sessionID: SessionID,
  createdAt: Timestamp,
  ...SyntheticItem.fields,
}).annotate({ identifier: "Session.Inbox.Synthetic" })
/** Admitted synthetic input returned by the Session operation. */
export interface Synthetic extends Schema.Schema.Type<typeof Synthetic> {}
/** Complete current-state projection of an admitted Inbox item. */
export const Info = Schema.Union([
  Schema.Struct({ ...InfoBase, ...UserItem.fields }),
  Schema.Struct({ ...InfoBase, ...SyntheticItem.fields }),
  Schema.Struct({ ...InfoBase, ...CompactionItem.fields }),
]).pipe(Schema.toTaggedUnion("type"), Schema.annotate({ identifier: "Session.Inbox.Info" }))
export type Info = typeof Info.Type
