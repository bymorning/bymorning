import { Agent } from "./agent.js"
import { MessageID } from "./identifier.js"
import { LLMGateway } from "./llm-gateway.js"
import { Model } from "./model.js"
import { Session } from "./session.js"
import { Workspace } from "./workspace.js"
import { Schema } from "effect"

/** Expected inference-hook refusal or dependency failure. */
export class ModelError extends Schema.TaggedError<ModelError>()("Plugin.ModelError", {
  reason: Schema.Literals(["denied", "model", "budget", "rate", "unavailable"]),
  message: Schema.String,
  retryAfter: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
}) {}

/** Physical Session inference purpose. */
export const ModelPurpose = Schema.Literals(["assistant", "generate", "compaction", "title", "route"])
/** Physical Session inference purpose. */
export type ModelPurpose = typeof ModelPurpose.Type

/** Final, immutable selection presented to inference admission hooks. */
export const ModelInput = Schema.Struct({
  id: Schema.NonEmptyString,
  workspaceID: Workspace.ID,
  model: Model.Ref,
  publicModel: Schema.NonEmptyString,
  stream: Schema.Boolean,
})
/** Final, immutable selection presented to inference admission hooks. */
export interface ModelInput extends Schema.Schema.Type<typeof ModelInput> {}

/** Session facts supplied by the Session execution owner. */
export const SessionInput = Schema.Struct({
  ...ModelInput.fields,
  sessionID: Session.ID,
  messageID: Schema.optionalKey(MessageID),
  agent: Agent.ID,
  purpose: ModelPurpose,
})
/** Session facts supplied by the Session execution owner. */
export interface SessionInput extends Schema.Schema.Type<typeof SessionInput> {}

/** Gateway facts without caller or Session identity. */
export const GatewayInput = Schema.Struct({
  ...ModelInput.fields,
  protocol: LLMGateway.Protocol,
})
/** Gateway facts without caller or Session identity. */
export interface GatewayInput extends Schema.Schema.Type<typeof GatewayInput> {}
