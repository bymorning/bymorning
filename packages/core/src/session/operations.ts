import { Message, ToolChoice } from "@opencode-ai/ai/schema/messages"
import { Effect, Stream } from "effect"
import { Bus } from "../bus.js"
import { ModelResolver } from "../model-resolver.js"
import { Permission } from "../permission.js"
import { PluginHooks } from "../plugin/hooks.js"
import { Provider } from "../provider.js"
import { Session } from "../session.js"
import { SessionHttp } from "./http.js"
import { SessionModelRequest } from "./model-request.js"
import { Routing } from "../routing.js"

/** Execute the transient one-shot Session generation operation. */
export const generate = (
  input: { readonly sessionID: import("@bymorning/schema/session").Session.ID; readonly prompt: string },
  activatePlugins: Effect.Effect<void, import("../plugin/registry-service.js").ActivationError>,
) =>
  Effect.gen(function* () {
    yield* activatePlugins.pipe(
      Effect.mapError(() => new Provider.FailureError({ cause: "Required inference Plugin is unavailable" })),
    )
    const sessions = yield* Session.Service
    const providers = yield* Provider.Service
    const hooks = yield* PluginHooks.Service
    const permission = yield* Permission.Service
    const bus = yield* Bus.Service
    const resolver = yield* ModelResolver.Service
    const routing = yield* Effect.serviceOption(Routing.Service)
    const session = yield* sessions.get(input.sessionID)
    const request = yield* SessionModelRequest.plan({
      purpose: "generate",
      sessionID: input.sessionID,
      projectID: session.projectID,
      agent: session.agent,
      requestedModel: session.model,
    }).pipe(
      SessionModelRequest.withRouting(routing),
      Effect.provideService(Provider.Service, providers),
      Effect.provideService(PluginHooks.Service, hooks),
      Effect.provideService(Permission.Service, permission),
      Effect.provideService(Bus.Service, bus),
      Effect.provideService(ModelResolver.Service, resolver),
      Effect.mapError(() => new Provider.FailureError({ cause: "Provider request failed" })),
    )
    const context = yield* hooks.trigger("session", "context", {
      sessionID: input.sessionID,
      agent: session.agent,
      requestedModel: request.requestedModel,
      model: request.model,
      system: [],
      messages: [Message.user(input.prompt)],
      tools: {},
    })
    const providerContext = {
      purpose: request.purpose,
      sessionID: request.sessionID,
      agent: request.agent,
      requestedModel: request.requestedModel,
      model: request.model,
    }
    const http = yield* SessionHttp.middleware(providerContext).pipe(Effect.provideService(PluginHooks.Service, hooks))
    const chunks: string[] = []
    yield* providers
      .stream({
        context: providerContext,
        selection: request.resolved.selection,
        runtimeModel: request.resolved.runtimeModel,
        authentication: request.resolved.authentication,
        http,
        messages: context.messages,
        system: context.system,
        tools: [],
        toolChoice: ToolChoice.make("none"),
      })
      .pipe(
        Stream.runForEach((event) => {
          if (event.type === "text-delta") chunks.push(event.text)
          return Effect.void
        }),
      )
    return chunks.join("")
  })
