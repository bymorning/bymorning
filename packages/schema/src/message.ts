export * as MessageSchema from "./message.js"

import { Schema } from "effect"
import { AgentID } from "./agent-id.js"
import { MessageID, SessionID } from "./identifier.js"
import { Ref as ModelRef } from "./model.js"
import { Route } from "./routing.js"
import { PositiveInt, Timestamp } from "./schema.js"
import { Error as SessionError } from "./session-error.js"
import { UserPayload, Delivery } from "./session-inbox.js"
import { AgentAttachment } from "./prompt.js"
import { Usage } from "./usage.js"

const Sequence = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }))
const Metadata = Schema.Record(Schema.String, Schema.Json)

const ToolText = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })
const ToolFile = Schema.Struct({
  type: Schema.Literal("file"),
  uri: Schema.String,
  mime: Schema.String,
  name: Schema.optional(Schema.String),
})

/** Durable content returned by a Tool invocation. */
export const ToolContent = Schema.Union([ToolText, ToolFile]).pipe(Schema.toTaggedUnion("type"))
/** Durable content returned by a Tool invocation. */
export type ToolContent = typeof ToolContent.Type

export const ID = MessageID
export type ID = typeof ID.Type

export const ToolStreaming = Schema.Struct({ status: Schema.Literal("streaming"), input: Schema.String })
export const ToolRunning = Schema.Struct({
  status: Schema.Literal("running"),
  input: Schema.Record(Schema.String, Schema.Json),
  metadata: Schema.optionalKey(Metadata),
})
export const ToolCompleted = Schema.Struct({
  status: Schema.Literal("completed"),
  input: Schema.Record(Schema.String, Schema.Json),
  content: Schema.Array(ToolContent),
  result: Schema.optionalKey(Schema.Json),
  metadata: Schema.optionalKey(Metadata),
})
export const ToolFailed = Schema.Struct({
  status: Schema.Literal("error"),
  input: Schema.Record(Schema.String, Schema.Json),
  error: SessionError,
  metadata: Schema.optionalKey(Metadata),
})
export const ToolState = Schema.Union([ToolStreaming, ToolRunning, ToolCompleted, ToolFailed]).pipe(
  Schema.toTaggedUnion("status"),
)
export type ToolState = typeof ToolState.Type

const Provider = {
  providerExecuted: Schema.optionalKey(Schema.Boolean),
  providerMetadata: Schema.optionalKey(Metadata),
}
const PartID = Schema.String.check(Schema.isMinLength(1))
export const TextPart = Schema.Struct({
  type: Schema.Literal("text"),
  id: PartID,
  text: Schema.String,
  ...Provider,
})
export const ReasoningPart = Schema.Struct({
  type: Schema.Literal("reasoning"),
  id: PartID,
  text: Schema.String,
  ...Provider,
  time: Schema.optionalKey(Schema.Struct({ created: Timestamp, completed: Schema.optionalKey(Timestamp) })),
})
export const ToolPart = Schema.Struct({
  type: Schema.Literal("tool"),
  id: PartID,
  name: Schema.String,
  state: ToolState,
  ...Provider,
  time: Schema.Struct({
    created: Timestamp,
    ran: Schema.optionalKey(Timestamp),
    completed: Schema.optionalKey(Timestamp),
  }),
})
export const AssistantPart = Schema.Union([TextPart, ReasoningPart, ToolPart]).pipe(Schema.toTaggedUnion("type"))
export type AssistantPart = typeof AssistantPart.Type
export const AssistantContent = Schema.Array(AssistantPart)
export type AssistantContent = typeof AssistantContent.Type
const HistoricalTextPart = Schema.Struct({ ...TextPart.fields, id: Schema.String })
const HistoricalReasoningPart = Schema.Struct({ ...ReasoningPart.fields, id: Schema.String })
const HistoricalToolPart = Schema.Struct({ ...ToolPart.fields, id: Schema.String })
const HistoricalAssistantContent = Schema.Array(
  Schema.Union([HistoricalTextPart, HistoricalReasoningPart, HistoricalToolPart]).pipe(Schema.toTaggedUnion("type")),
)

const base = { id: ID, sessionID: SessionID, sequence: Sequence, createdAt: Timestamp }
const Retry = Schema.Struct({ attempt: PositiveInt, at: Timestamp, error: SessionError })
export const User = Schema.Struct({
  ...base,
  type: Schema.Literal("user"),
  ...UserPayload.fields,
  delivery: Schema.optionalKey(Delivery),
  admittedSequence: Sequence,
})
export interface User extends Schema.Schema.Type<typeof User> {}
/** Durable synthetic context with client-only presentation metadata. */
export const Synthetic = Schema.Struct({
  ...base,
  type: Schema.Literal("synthetic"),
  text: Schema.String,
  description: Schema.optionalKey(Schema.String),
  metadata: Schema.optionalKey(Metadata),
})
/** Durable synthetic context with client-only presentation metadata. */
export interface Synthetic extends Schema.Schema.Type<typeof Synthetic> {}
/** Durable model-facing system update. */
export const System = Schema.Struct({
  ...base,
  type: Schema.Literal("system"),
  text: Schema.String,
  description: Schema.optionalKey(Schema.String),
})
/** Durable model-facing system update. */
export interface System extends Schema.Schema.Type<typeof System> {}
export const Assistant = Schema.Struct({
  ...base,
  type: Schema.Literal("assistant"),
  agent: AgentID,
  model: ModelRef,
  requestedModel: Schema.optionalKey(ModelRef),
  route: Schema.optionalKey(Route),
  content: AssistantContent,
  finish: Schema.optionalKey(Schema.Literals(["length", "stop", "tool-calls", "content-filter", "error", "unknown"])),
  error: Schema.optionalKey(SessionError),
  time: Schema.Struct({
    created: Timestamp,
    streamed: Schema.optionalKey(Timestamp),
    completed: Schema.optionalKey(Timestamp),
  }),
  retry: Schema.optionalKey(Retry),
  usage: Usage,
})
export interface Assistant extends Schema.Schema.Type<typeof Assistant> {}
/** Historical assistant projection retained before Agent and Usage became current write invariants. */
export const HistoricalAssistant = Schema.Struct({
  ...base,
  type: Schema.Literal("assistant"),
  agent: Schema.optionalKey(AgentID),
  model: ModelRef,
  requestedModel: Schema.optionalKey(ModelRef),
  route: Schema.optionalKey(Route),
  content: HistoricalAssistantContent,
  finish: Schema.optionalKey(Schema.Literals(["length", "stop", "tool-calls", "content-filter", "error", "unknown"])),
  error: Schema.optionalKey(SessionError),
  time: Schema.Struct({
    created: Timestamp,
    streamed: Schema.optionalKey(Timestamp),
    completed: Schema.optionalKey(Timestamp),
  }),
  retry: Schema.optionalKey(Retry),
  usage: Schema.optionalKey(Usage),
})
/** Historical assistant projection retained before Agent and Usage became current write invariants. */
export interface HistoricalAssistant extends Schema.Schema.Type<typeof HistoricalAssistant> {}
/** Visible Agent selection transcript contribution. */
export const AgentSwitched = Schema.Struct({ ...base, type: Schema.Literal("agent-switched"), agent: AgentID })
/** Visible Agent selection transcript contribution. */
export interface AgentSwitched extends Schema.Schema.Type<typeof AgentSwitched> {}
/** Visible Model selection transcript contribution. */
export const ModelSwitched = Schema.Struct({ ...base, type: Schema.Literal("model-switched"), model: ModelRef })
/** Visible Model selection transcript contribution. */
export interface ModelSwitched extends Schema.Schema.Type<typeof ModelSwitched> {}
const CompactionBase = {
  ...base,
  type: Schema.Literal("compaction"),
  reason: Schema.Literals(["manual", "auto"]),
}
/** In-progress conversation compaction transcript contribution. */
export const CompactionRunning = Schema.Struct({
  ...CompactionBase,
  status: Schema.Literal("running"),
  summary: Schema.String,
  recent: Schema.String,
})
/** In-progress conversation compaction transcript contribution. */
export interface CompactionRunning extends Schema.Schema.Type<typeof CompactionRunning> {}
/** Completed conversation compaction transcript contribution. */
export const CompactionCompleted = Schema.Struct({
  ...CompactionBase,
  status: Schema.Literal("completed"),
  summary: Schema.String,
  recent: Schema.String,
})
/** Completed conversation compaction transcript contribution. */
export interface CompactionCompleted extends Schema.Schema.Type<typeof CompactionCompleted> {}
/** Failed conversation compaction transcript contribution. */
export const CompactionFailed = Schema.Struct({
  ...CompactionBase,
  status: Schema.Literal("failed"),
  error: SessionError,
})
/** Failed conversation compaction transcript contribution. */
export interface CompactionFailed extends Schema.Schema.Type<typeof CompactionFailed> {}
/** Durable conversation compaction transcript contribution. */
export const Compaction = Schema.Union([CompactionRunning, CompactionCompleted, CompactionFailed]).pipe(
  Schema.toTaggedUnion("status"),
)
/** Durable conversation compaction transcript contribution. */
export type Compaction = typeof Compaction.Type
export const Message = Schema.Union([
  User,
  Synthetic,
  System,
  HistoricalAssistant,
  AgentSwitched,
  ModelSwitched,
  Compaction,
])
export type Message = typeof Message.Type

export const Input = Schema.Struct({
  id: Schema.optionalKey(ID),
  ...UserPayload.fields,
  delivery: Schema.optionalKey(Delivery),
  resume: Schema.optionalKey(Schema.Boolean),
})
export interface Input extends Schema.Schema.Type<typeof Input> {}
export const Admitted = Schema.Struct({
  id: ID,
  sessionID: SessionID,
  text: Schema.String,
  agents: Schema.optionalKey(Schema.mutable(Schema.Array(AgentAttachment))),
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  delivery: Schema.optionalKey(Delivery),
  admittedSequence: Sequence,
  createdAt: Timestamp,
})
export interface Admitted extends Schema.Schema.Type<typeof Admitted> {}
export const PageDirection = Schema.Literals(["previous", "next"])
export type PageDirection = typeof PageDirection.Type
export const ListCursor = Schema.Struct({ id: ID, direction: PageDirection })
export type ListCursor = typeof ListCursor.Type
export const ListInput = Schema.Struct({
  sessionID: SessionID,
  cursor: Schema.optionalKey(ListCursor),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
  order: Schema.optionalKey(Schema.Literals(["asc", "desc"])),
})
export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
