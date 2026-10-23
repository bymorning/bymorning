export * as SessionOperations from "./session-operations.js"

import { MessageSchema } from "@bymorning/schema/message"
import { SessionSchema } from "@bymorning/schema/session"
import { SessionInbox } from "@bymorning/schema/session-inbox"
import { Context, Crypto, Effect, Layer, Schema } from "effect"
import { Command } from "./command.js"
import type { Model } from "./model.js"
import { PluginHooks } from "./plugin/hooks.js"
import { Plugin } from "./plugin.js"
import { Provider } from "./provider.js"
import type { Project } from "./project.js"
import { Session } from "./session.js"
import { ModelResolver } from "./model-resolver.js"
import { Permission } from "./permission.js"
import { Bus } from "./bus.js"
import { Usage } from "./usage.js"
import { Budget } from "./budget.js"
import { Limiter } from "./limiter.js"
import { User } from "./user.js"
import { ServiceAccount } from "./service-account.js"
import { generate } from "./session/operations.js"
import { makeWorkspaceNode, type GlobalNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"
import { LayerNodePlatform } from "@bymorning/util/effect/app-node-platform"
import { Routing } from "./routing.js"
import { SessionModelRequest } from "./session/model-request.js"

export interface Interface {
  readonly rename: (input: {
    readonly sessionID: SessionSchema.ID
    readonly title: string
  }) => Effect.Effect<void, Session.NotFoundError>
  readonly command: (input: {
    readonly sessionID: SessionSchema.ID
    readonly id?: MessageSchema.ID
    readonly command: string
    readonly arguments?: string
  }) => Effect.Effect<
    import("@bymorning/schema/message").Admitted,
    | Session.NotFoundError
    | Session.PromptConflictError
    | Project.ArchivedError
    | Command.NotFoundError
    | Command.EvaluationError
  >
  readonly synthetic: (
    input: SessionSchema.SyntheticInput,
  ) => Effect.Effect<SessionInbox.Synthetic, Session.NotFoundError | Session.SyntheticConflictError>
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<void, Session.NotFoundError | Session.RunError>
  readonly wait: (sessionID: SessionSchema.ID) => Effect.Effect<void, Session.NotFoundError>
  readonly generate: (input: {
    readonly sessionID: SessionSchema.ID
    readonly prompt: string
  }) => Effect.Effect<
    string,
    Session.NotFoundError | Model.NotFoundError | Provider.FailureError | Provider.ContextOverflowError
  >
}

/** Pinned transient and convenience Session operations layered over durable Session authority. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/SessionOperations") {}

export const sharedLayer = (
  activatePlugins: Effect.Effect<void, import("./plugin/registry-service.js").ActivationError, Plugin.Service> =
    Effect.void,
) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const commands = yield* Command.Service
      const crypto = yield* Crypto.Crypto
      const hooks = yield* PluginHooks.Service
      const permission = yield* Permission.Service
      const bus = yield* Bus.Service
      const resolver = yield* ModelResolver.Service
      const plugin = yield* Plugin.Service
      const routing = yield* Effect.serviceOption(Routing.Service)
      const observedProvider = Context.get(
        yield* Layer.build(
          Usage.sessionProviderLayer.pipe(Layer.provide(Layer.mergeAll(Budget.sharedLayer, Limiter.sharedLayer))),
        ) as Effect.Effect<Context.Context<Provider.Service>>,
        Provider.Service,
      )
      const admit = Effect.fn("SessionOperations.admit")(function* (input: {
        readonly sessionID: SessionSchema.ID
        readonly id?: MessageSchema.ID
        readonly text: string
      }) {
        const id =
          input.id ??
          (yield* crypto.randomUUIDv4.pipe(Effect.flatMap(Schema.decodeUnknownEffect(MessageSchema.ID)), Effect.orDie))
        return yield* sessions.prompt({ sessionID: input.sessionID, id, text: input.text })
      })

      return Service.of({
        rename: (input) =>
          sessions.update(input).pipe(Effect.catchTag("Project.NotFoundError", Effect.die), Effect.asVoid),
        command: Effect.fn("SessionOperations.command")(function* (input) {
          const evaluated = yield* commands.evaluate({ name: input.command, arguments: input.arguments })
          return yield* admit({ sessionID: input.sessionID, id: input.id, text: evaluated.text })
        }),
        synthetic: (input) => sessions.synthetic(input),
        resume: (sessionID) => sessions.resume(sessionID),
        wait: (sessionID) => sessions.awaitIdle(sessionID),
        generate: (input) =>
          generate(input, activatePlugins.pipe(Effect.provideService(Plugin.Service, plugin))).pipe(
            SessionModelRequest.withRouting(routing),
            Effect.provideService(Session.Service, sessions),
            Effect.provideService(Provider.Service, observedProvider),
            Effect.provideService(PluginHooks.Service, hooks),
            Effect.provideService(Permission.Service, permission),
            Effect.provideService(Bus.Service, bus),
            Effect.provideService(ModelResolver.Service, resolver),
          ),
      })
    }),
  )

/** Isolated operation facade for focused graphs. Member graphs receive the Application-owned Budget state. */
export const layer = (
  activatePlugins: Effect.Effect<void, import("./plugin/registry-service.js").ActivationError, Plugin.Service> =
    Effect.void,
) =>
  sharedLayer(activatePlugins).pipe(Layer.provide(Layer.mergeAll(Budget.stateMemory, Limiter.stateMemory)))

/** Canonical Session operation facade with plugin readiness in its member environment. */
export const node = makeWorkspaceNode({
  service: Service,
  layer: sharedLayer(Effect.suspend(() => Plugin.awaitActivation)),
  deps: [
    Session.node,
    Command.node,
    LayerNodePlatform.crypto,
    Provider.node,
    PluginHooks.node,
    Session.permission,
    Bus.node,
    ModelResolver.node,
    Routing.node,
    Plugin.node,
    Usage.node,
    User.node,
    ServiceAccount.node,
    Budget.stateNode,
    Limiter.stateNode,
  ],
})

/** @deprecated Compose the canonical `node`; retained while callers migrate. */
export const workspaceNodes = <E>(input: {
  readonly session: WorkspaceNode<Session.Service, E>
  readonly command: WorkspaceNode<Command.Service, E>
  readonly crypto: GlobalNode<Crypto.Crypto, E>
  readonly hooks: WorkspaceNode<PluginHooks.Service, E>
  readonly permission: WorkspaceNode<Permission.Service, E>
  readonly bus: WorkspaceNode<Bus.Service, E>
  readonly modelResolver: WorkspaceNode<ModelResolver.Service, E>
  readonly plugin: WorkspaceNode<Plugin.Service, E>
  readonly activatePlugins: Effect.Effect<void, import("./plugin/registry-service.js").ActivationError, Plugin.Service>
}) =>
  makeWorkspaceNode({
    service: Service,
    layer: sharedLayer(input.activatePlugins),
    deps: [
      input.session,
      input.command,
      input.crypto,
      Provider.node,
      input.hooks,
      input.permission,
      input.bus,
      input.modelResolver,
      input.plugin,
      Usage.node,
      User.node,
      ServiceAccount.node,
      Budget.stateNode,
      Limiter.stateNode,
    ],
  })
