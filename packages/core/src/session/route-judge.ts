export * as SessionRouteJudge from "./route-judge.js"

import { Message, ToolChoice } from "@opencode-ai/ai/schema/messages"
import type { Agent } from "@bymorning/schema/agent"
import type { ID as MessageID } from "@bymorning/schema/message"
import type { Project } from "@bymorning/schema/project"
import type { Session } from "@bymorning/schema/session"
import { Effect, Stream } from "effect"
import { Bus } from "../bus.js"
import { ModelResolver } from "../model-resolver.js"
import { Permission } from "../permission.js"
import { PluginHooks } from "../plugin/hooks.js"
import { Provider } from "../provider.js"
import type { Routing } from "../routing.js"
import { SessionHttp } from "./http.js"
import { SessionModelRequest } from "./model-request.js"

/** The Session authorities a judge inference runs under. */
export interface Services {
  readonly providers: Provider.Interface
  readonly hooks: PluginHooks.Interface
  readonly permission: Permission.Interface
  readonly bus: Bus.Interface
  readonly resolver: ModelResolver.Interface
}

/** The Session request a judge inference is attributed to. */
export interface Context {
  readonly sessionID: Session.ID
  readonly projectID?: Project.ID
  readonly messageID?: MessageID
  readonly agent: Agent.ID
}

/**
 * Judge callback for Session Routing. The judge runs as its own `route` inference through the
 * decorated Session Provider, so Budget reserves and settles it, Limiter admits it, and Usage
 * records it against the Session's User like any other Session inference.
 */
export const make =
  (services: Services, context: Context) =>
  (request: Routing.JudgeRequest): Effect.Effect<Routing.JudgeReply, unknown> =>
    Effect.gen(function* () {
      const planned = yield* SessionModelRequest.plan({
        purpose: "route",
        sessionID: context.sessionID,
        ...(context.projectID === undefined ? {} : { projectID: context.projectID }),
        ...(context.messageID === undefined ? {} : { messageID: context.messageID }),
        agent: context.agent,
        requestedModel: request.model,
      }).pipe(
        Effect.provideService(Provider.Service, services.providers),
        Effect.provideService(PluginHooks.Service, services.hooks),
        Effect.provideService(Permission.Service, services.permission),
        Effect.provideService(Bus.Service, services.bus),
        Effect.provideService(ModelResolver.Service, services.resolver),
      )
      const providerContext = {
        purpose: planned.purpose,
        sessionID: planned.sessionID,
        messageID: planned.messageID,
        agent: planned.agent,
        requestedModel: planned.requestedModel,
        model: planned.model,
      }
      const http = yield* SessionHttp.middleware(providerContext).pipe(
        Effect.provideService(PluginHooks.Service, services.hooks),
      )
      const chunks: string[] = []
      yield* services.providers
        .stream({
          context: providerContext,
          selection: planned.resolved.selection,
          runtimeModel: planned.resolved.runtimeModel,
          authentication: planned.resolved.authentication,
          http,
          messages: [Message.user(request.prompt)],
          system: request.system,
          tools: [],
          toolChoice: ToolChoice.make("none"),
        })
        .pipe(
          Stream.runForEach((event) => {
            if (event.type === "text-delta") chunks.push(event.text)
            return Effect.void
          }),
        )
      return { text: chunks.join("") }
    })
