/** Declares the Session Event contract owned by this module. */
export * as SessionEvent from "./session-event.js"

import { Schema } from "effect"
import * as Agent from "./agent.js"
import * as Event from "./event.js"
import * as Form from "./form.js"
import * as Instruction from "./instruction.js"
import * as Message from "./message.js"
import * as Model from "./model.js"
import * as Routing from "./routing.js"
import * as Permission from "./permission.js"
import * as Session from "./session.js"
import * as SessionError from "./session-error.js"
import * as SessionInbox from "./session-inbox.js"
import { PositiveInt, Timestamp } from "./schema.js"
import { Usage } from "./usage.js"

export { ID } from "./event.js"
const Index = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))
const Ordinal = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER))
const Metadata = Schema.Record(Schema.String, Schema.Json)
const PartID = Schema.String.check(Schema.isMinLength(1))
const Base = { sessionID: Session.ID, messageID: Message.ID }
const define = <const T extends string, const F extends Readonly<Record<PropertyKey, Schema.Codec<unknown, unknown>>>>(
  type: T,
  fields: F,
) => Event.define(type, fields)
const Finish = Schema.Literals(["length", "stop", "tool-calls", "content-filter", "error", "unknown"])

export const Created = define("session.created", { sessionID: Session.ID, session: Session.Info })
export const Updated = define("session.updated", { sessionID: Session.ID, session: Session.Info })
export const Deleted = define("session.deleted", { sessionID: Session.ID })
export const InputAdmitted = define("session.input.admitted", { sessionID: Session.ID, item: SessionInbox.Info })
export const InputPromoted = define("session.input.promoted", {
  sessionID: Session.ID,
  inboxID: Message.ID,
  message: Message.User,
})
export const SyntheticAdmitted = define("session.synthetic.admitted", { sessionID: Session.ID, item: SessionInbox.Info })
export const SyntheticPromoted = define("session.synthetic.promoted", {
  sessionID: Session.ID,
  inboxID: Message.ID,
  message: Message.Synthetic,
})
export const RunStarted = define("session.run.started", { sessionID: Session.ID })
export const RunSucceeded = define("session.run.succeeded", { sessionID: Session.ID })
export const RunFailed = define("session.run.failed", { sessionID: Session.ID, error: SessionError.Error })
export const RunInterrupted = define("session.run.interrupted", {
  sessionID: Session.ID,
  reason: Schema.Literals(["user", "shutdown", "superseded"]),
})
export const RunDefinitions = Event.inventory(RunStarted, RunSucceeded, RunFailed, RunInterrupted)
export const ExecutionStarted = define("session.execution.started", { sessionID: Session.ID, message: Message.Assistant })
export const ExecutionModelRouted = define("session.execution.model.routed", { ...Base, requestedModel: Model.Ref, model: Model.Ref, route: Schema.optionalKey(Routing.Route) })
export const ExecutionStreamed = define("session.execution.streamed", { ...Base, attempt: PositiveInt })
export const RetryScheduled = define("session.retry.scheduled", { ...Base, attempt: PositiveInt, at: Timestamp, error: SessionError.Error })
export const Succeeded = define("session.execution.succeeded", { sessionID: Session.ID, message: Message.Assistant, finish: Finish })
export const Failed = define("session.execution.failed", { sessionID: Session.ID, message: Message.Assistant, error: SessionError.Error, finish: Schema.optionalKey(Finish) })
export const Interrupted = define("session.execution.interrupted", { sessionID: Session.ID, message: Message.Assistant, error: SessionError.Aborted })
export const StepStarted = define("session.step.started", { ...Base, index: Index })
export const StepEnded = define("session.step.ended", { ...Base, index: Index, finish: Schema.String, usage: Usage })
export const StepFailed = define("session.step.failed", { ...Base, index: Index, error: SessionError.Error })
export const TextStarted = define("session.text.started", { ...Base, partID: PartID, ordinal: Ordinal })
export const TextDelta = define("session.text.delta", { ...Base, partID: PartID, text: Schema.String })
export const TextEnded = define("session.text.ended", { ...Base, partID: PartID, text: Schema.String, providerMetadata: Schema.optionalKey(Metadata) })
export const ReasonStarted = define("session.reasoning.started", { ...Base, partID: PartID, ordinal: Ordinal })
export const ReasonDelta = define("session.reasoning.delta", { ...Base, partID: PartID, text: Schema.String })
export const ReasonEnded = define("session.reasoning.ended", { ...Base, partID: PartID, text: Schema.String, providerMetadata: Schema.optionalKey(Metadata) })
export const InputStarted = define("session.tool.input.started", { ...Base, callID: PartID, ordinal: Ordinal, name: Schema.String, providerExecuted: Schema.optionalKey(Schema.Boolean), providerMetadata: Schema.optionalKey(Metadata) })
export const InputDelta = define("session.tool.input.delta", { ...Base, callID: PartID, text: Schema.String })
export const InputEnded = define("session.tool.input.ended", { ...Base, callID: PartID, name: Schema.String, input: Schema.String, providerMetadata: Schema.optionalKey(Metadata) })
export const ToolCalled = define("session.tool.called", { ...Base, callID: PartID, name: Schema.String, input: Schema.Record(Schema.String, Schema.Json), providerExecuted: Schema.optionalKey(Schema.Boolean), providerMetadata: Schema.optionalKey(Metadata) })
export const ToolProgress = define("session.tool.progress", { ...Base, callID: PartID, metadata: Metadata })
export const PolicyToolAdmitted = define("session.policy.tool.admitted", { sessionID: Session.ID, callID: PartID, tool: Schema.NonEmptyString })
export const PolicyEnforced = define("session.policy.enforced", { sessionID: Session.ID, messageID: Schema.optionalKey(Message.ID), callID: Schema.optionalKey(PartID), policy: Schema.NonEmptyString, rule: Schema.Finite, action: Schema.NonEmptyString, resource: Schema.NonEmptyString, effect: Schema.Literals(["route", "deny", "transform"]), message: Schema.optionalKey(Schema.String) })
export const PermissionAsked = define("permission.v2.asked", Permission.Request.fields)
export const PermissionReplied = define("permission.v2.replied", { sessionID: Session.ID, requestID: Permission.ID, reply: Permission.Reply })
// Session feeds only carry Session-owned Forms; caller-bound Forms are read through Form routes.
export const FormCreated = define("form.created", {
  id: Form.ID,
  sessionID: Session.ID,
  title: Form.Info.fields.title,
  metadata: Form.Info.fields.metadata,
  fields: Form.Fields,
})
export const FormReplied = define("form.replied", { id: Form.ID, sessionID: Session.ID, answer: Form.Answer })
export const FormCancelled = define("form.cancelled", { id: Form.ID, sessionID: Session.ID })
export const ToolSuccess = define("session.tool.success", { ...Base, callID: PartID, name: Schema.String, input: Schema.Record(Schema.String, Schema.Json), content: Schema.Array(Message.ToolContent), result: Schema.optionalKey(Schema.Json), metadata: Schema.optionalKey(Metadata), providerExecuted: Schema.optionalKey(Schema.Boolean), providerMetadata: Schema.optionalKey(Metadata) })
export const ToolFailed = define("session.tool.failed", { ...Base, callID: PartID, name: Schema.String, input: Schema.Record(Schema.String, Schema.Json), error: SessionError.Error, metadata: Schema.optionalKey(Metadata), providerExecuted: Schema.optionalKey(Schema.Boolean), providerMetadata: Schema.optionalKey(Metadata) })
export const AgentSwitched = define("session.next.agent.switched", { sessionID: Session.ID, message: Message.AgentSwitched, agent: Agent.ID })
export const ModelSwitched = define("session.next.model.switched", { sessionID: Session.ID, message: Message.ModelSwitched, model: Model.Ref })
export const InstructionUpdated = define("session.instruction.updated", { sessionID: Session.ID, delta: Instruction.Delta, system: Schema.optionalKey(Message.System) })
export const CompactionRequested = define("session.compaction.requested", Base)
export const CompactionStarted = define("session.compaction.started", { sessionID: Session.ID, message: Message.CompactionRunning })
export const CompactionDelta = define("session.compaction.delta", { ...Base, text: Schema.String })
export const CompactionEnded = define("session.compaction.ended", { sessionID: Session.ID, message: Message.CompactionCompleted, usage: Usage })
export const CompactionFailed = define("session.compaction.failed", { sessionID: Session.ID, message: Message.CompactionFailed, usage: Usage })

/** Every current client-visible Session Event. */
export const Definitions = Event.inventory(Created, Updated, Deleted, InputAdmitted, InputPromoted, SyntheticAdmitted, SyntheticPromoted, ...RunDefinitions, ExecutionStarted, ExecutionModelRouted, ExecutionStreamed, RetryScheduled, Succeeded, Failed, Interrupted, StepStarted, StepEnded, StepFailed, TextStarted, TextEnded, ReasonStarted, ReasonEnded, InputStarted, InputEnded, ToolCalled, ToolSuccess, ToolFailed, AgentSwitched, ModelSwitched, InstructionUpdated, CompactionRequested, CompactionStarted, CompactionEnded, CompactionFailed, TextDelta, ReasonDelta, InputDelta, ToolProgress, PolicyEnforced, PermissionAsked, PermissionReplied, FormCreated, FormReplied, FormCancelled, CompactionDelta)
/** Direct wire payload for a Session Event. */
export const Payload = Schema.Union(Definitions).annotate({ identifier: "SessionEvent.Payload" })
export type Payload = typeof Payload.Type
