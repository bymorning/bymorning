import type { SessionApi } from "@bymorning/client/effect/api"
import type { Agent } from "@bymorning/schema/agent"
import type { Model } from "@bymorning/schema/model"
import type { Session } from "@bymorning/schema/session"
import type { ModelHooks } from "./registration.js"
import type { SessionHooks } from "../session-hooks.js"
import type { SessionHook } from "./model.js"

export type {
  ModelRequestPurpose,
  SessionContext,
  SessionHooks,
  SessionHttpRequest,
  SessionHttpResponse,
  SessionModelRequest,
  SessionPrompt,
  SessionRetry,
  SessionRetryDecision,
} from "../session-hooks.js"

export type SessionDomain = Pick<
  SessionApi<unknown>,
  | "get"
  | "switchAgent"
  | "switchModel"
  | "prompt"
  | "generate"
  | "command"
  | "synthetic"
  | "interrupt"
  | "rename"
  | "wait"
> & {
  readonly create: (
    input:
      | Session.CreateInput
      | {
          readonly parentID: Session.ID
          readonly title?: Session.Title
          readonly agent?: Agent.ID
          readonly model?: Model.Ref
        },
  ) => import("effect").Effect.Effect<Session.Info, unknown>
  readonly hook: ModelHooks<SessionHooks> & SessionHook
}
