import type { Agent } from "@bymorning/schema/agent"
import type { ID as MessageID } from "@bymorning/schema/message"
import type { Model } from "@bymorning/schema/model"
import type { Session } from "@bymorning/schema/session"
import type { SessionError } from "@bymorning/schema/session-error"
import type { Message, SystemPart } from "@opencode-ai/ai/schema/messages"
import type { JsonSchema, Types } from "effect"

/** Physical inference purpose exposed to Session policy hooks. */
export type ModelRequestPurpose = "assistant" | "generate" | "compaction" | "title" | "route"

/** Mutable prompt draft immediately before durable admission. */
export interface SessionPrompt {
  readonly sessionID: Session.ID
  readonly messageID: MessageID
  prompt: Types.DeepMutable<Omit<Session.PromptInput, "sessionID" | "id">>
}

/** Mutable Session context immediately before provider inference. */
export interface SessionContext {
  readonly sessionID: Session.ID
  readonly messageID?: MessageID
  readonly agent: Agent.ID
  readonly requestedModel: Model.Ref
  readonly model: Model.Ref
  system: Array<SystemPart>
  messages: Array<Message>
  tools: Record<string, { description: string; input: JsonSchema.JsonSchema }>
}

/** Mutable request-scoped model destination and transport policy. */
export interface SessionModelRequest {
  readonly purpose: ModelRequestPurpose
  readonly sessionID: Session.ID
  readonly messageID?: MessageID
  readonly agent: Agent.ID
  readonly requestedModel: Model.Ref
  model: Model.Ref
  baseURL?: string
  headers: Record<string, string>
}

/** Mutable physical HTTP request policy boundary. */
export interface SessionHttpRequest {
  readonly purpose: ModelRequestPurpose
  readonly sessionID: Session.ID
  readonly messageID?: MessageID
  readonly agent: Agent.ID
  readonly requestedModel: Model.Ref
  readonly model: Model.Ref
  request: Request
}

/** Mutable physical HTTP response policy boundary. */
export interface SessionHttpResponse {
  readonly purpose: ModelRequestPurpose
  readonly sessionID: Session.ID
  readonly messageID?: MessageID
  readonly agent: Agent.ID
  readonly requestedModel: Model.Ref
  readonly model: Model.Ref
  readonly request: Request
  response: Response
}

/** A plugin may veto an automatic provider retry or adjust its delay. */
export type SessionRetryDecision = { retry: false } | { retry: true; delay: number }

/** Mutable provider retry decision. */
export interface SessionRetry {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly model: Model.Ref
  readonly error: SessionError.Error
  readonly attempt: number
  decision: SessionRetryDecision
}

/** Session plugin hook payloads. */
export interface SessionHooks {
  readonly prompt: SessionPrompt
  readonly context: SessionContext
  readonly "model.request": SessionModelRequest
  readonly "http.request": SessionHttpRequest
  readonly "http.response": SessionHttpResponse
  readonly retry: SessionRetry
}
