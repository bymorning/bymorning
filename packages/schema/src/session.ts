/** Exposes the Session contract owned by this module. */
export * as Session from "./session.js"
export * as SessionSchema from "./session.js"

import { Schema } from "effect"
import { AgentID } from "./agent-id.js"
import { SessionID } from "./identifier.js"
import { MessageSchema } from "./message.js"
import { Ref as ModelRef } from "./model.js"
import { ID as ProjectID } from "./project.js"
import { ID as ScheduledTaskID } from "./scheduled-task.js"
import { Timestamp } from "./schema.js"
import { Delivery, SyntheticPayload } from "./session-inbox.js"
import { Usage } from "./usage.js"

const Watermark = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
)
const Cursor = Schema.String.check(Schema.isMinLength(1), Schema.isPattern(/^[A-Za-z0-9_-]+$/))

/** A normalized Session title displayed in summary surfaces. */
export const Title = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255))
/** A normalized Session title displayed in summary surfaces. */
export type Title = typeof Title.Type

/** A durable UUID Session identifier. */
export const ID = SessionID

/** A durable UUID Session identifier. */
export type ID = typeof ID.Type

/** The requested Session does not exist. */
export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Session.NotFoundError", {
  sessionID: ID,
}) {}

/** Input required to create a Session in a Project. */
export const CreateInput = Schema.Struct({
  projectID: ProjectID,
  agent: Schema.optionalKey(AgentID),
  model: Schema.optionalKey(ModelRef),
})

/** Input required to create a Session in a Project. */
export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}

/** Input for updating Session summary metadata. */
export const UpdateInput = Schema.Struct({
  sessionID: ID,
  title: Schema.optionalKey(Title),
  projectID: Schema.optionalKey(ProjectID),
  archived: Schema.optionalKey(Schema.Boolean),
})

/** Input for updating Session summary metadata. */
export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}

/** Session metadata used in list and mutation responses. */
export const Info = Schema.Struct({
  id: ID,
  projectID: ProjectID,
  parentID: Schema.optionalKey(ID),
  title: Title,
  archivedAt: Schema.optionalKey(Timestamp),
  agent: AgentID,
  model: ModelRef,
  scheduledTaskID: Schema.optionalKey(ScheduledTaskID),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}).annotate({ identifier: "Session.Info" })

/** Session metadata used in list and mutation responses. */
export interface Info extends Schema.Schema.Type<typeof Info> {}

/** Session metadata with cumulative usage. */
export const Detail = Schema.Struct({ ...Info.fields, usage: Usage }).annotate({ identifier: "Session.Detail" })

/** Session metadata with cumulative usage. */
export interface Detail extends Schema.Schema.Type<typeof Detail> {}

/** Input used to change a Session's selected Agent. */
export const AgentInput = Schema.Struct({ sessionID: ID, agent: AgentID })
/** Input used to change a Session's selected Agent. */
export interface AgentInput extends Schema.Schema.Type<typeof AgentInput> {}

/** Input used to change a Session's selected Model Reference. */
export const ModelInput = Schema.Struct({ sessionID: ID, model: ModelRef })
/** Input used to change a Session's selected Model Reference. */
export interface ModelInput extends Schema.Schema.Type<typeof ModelInput> {}

/** Input for one page of Sessions. */
export const ListInput = Schema.Struct({
  cursor: Schema.optionalKey(Cursor),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  search: Schema.optionalKey(Schema.String),
  parentID: Schema.optionalKey(Schema.NullOr(ID)),
  archived: Schema.optionalKey(Schema.Boolean),
})

/** Input for one page of Sessions. */
export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}

/** Input for admitting one prompt to a Session. */
export const PromptInput = Schema.Struct({
  sessionID: ID,
  ...MessageSchema.Input.fields,
})
/** Exposes the PromptInput contract owned by this module. */
export interface PromptInput extends Schema.Schema.Type<typeof PromptInput> {}

/** Input for admitting synthetic model context to a Session. */
export const SyntheticInput = Schema.Struct({
  sessionID: ID,
  id: Schema.optionalKey(MessageSchema.ID),
  ...SyntheticPayload.fields,
  delivery: Schema.optionalKey(Delivery),
  resume: Schema.optionalKey(Schema.Boolean),
})
/** Input for admitting synthetic model context to a Session. */
export interface SyntheticInput extends Schema.Schema.Type<typeof SyntheticInput> {}

/** Input for manually compacting one Session. */
export const CompactInput = Schema.Struct({ sessionID: ID, id: Schema.optionalKey(MessageSchema.ID) })
/** Input for manually compacting one Session. */
export interface CompactInput extends Schema.Schema.Type<typeof CompactInput> {}

/** Input for replaying and following one Session log. */
export const LogInput = Schema.Struct({
  sessionID: ID,
  after: Schema.optionalKey(Watermark.check(Schema.isGreaterThanOrEqualTo(1))),
})
/** Exposes the LogInput contract owned by this module. */
export interface LogInput extends Schema.Schema.Type<typeof LogInput> {}

/** One page of Sessions ordered by most recent update. */
export const Page = Schema.Struct({
  data: Schema.Array(Info),
  cursor: Schema.optionalKey(Cursor),
}).annotate({ identifier: "Session.Page" })

/** One page of Sessions ordered by most recent update. */
export interface Page extends Schema.Schema.Type<typeof Page> {}
