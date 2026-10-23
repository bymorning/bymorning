/** Exposes the private Session execution authority owned by this module. */
export * as SessionExecution from "./execution.js"

import { type GlobalNode, makeWorkspaceNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"
import { LayerNodePlatform } from "@bymorning/util/effect/app-node-platform"
import { Admitted, ID } from "@bymorning/schema/message"
import { Session } from "@bymorning/schema/session"
import { SessionEvent } from "@bymorning/schema/session-event"
import { SessionError } from "@bymorning/schema/session-error"
import type { SessionInbox as InboxSchema } from "@bymorning/schema/session-inbox"
import { Workspace } from "@bymorning/schema/workspace"
import { Cause, Context, Crypto, Effect, Exit, Layer, Schedule, Schema, Stream } from "effect"
import { Agent } from "../agent.js"
import { Actor } from "../actor.js"
import { Bus } from "../bus.js"
import { Config } from "../config.js"
import { Database } from "../database.js"
import { InstructionEntry } from "../instruction-entry.js"
import { InstructionDiscovery } from "../instruction-discovery.js"
import { Job } from "../job.js"
import { Model } from "../model.js"
import { ModelResolver } from "../model-resolver.js"
import { Mcp } from "../mcp.js"
import { PluginHooks } from "../plugin/hooks.js"
import type { SessionPrompt } from "@bymorning/plugin/effect/session"
import { PluginActivation } from "../plugin/activation.js"
import { Permission } from "../permission.js"
import { Provider } from "../provider.js"
import { Reference } from "../reference.js"
import { SkillInstruction } from "../skill-instruction.js"
import { Storage } from "../storage.js"
import { ToolOutput } from "../tool-output.js"
import { Usage } from "../usage.js"
import { Budget } from "../budget.js"
import { Limiter } from "../limiter.js"
import { User } from "../user.js"
import { ServiceAccount } from "../service-account.js"
import { Coordinator } from "./coordinator.js"
import { SessionInbox } from "./inbox.js"
import { SessionPermission } from "./permission.js"
import { Runner } from "./runner.js"
import { Routing } from "../routing.js"
import { SessionTitle } from "./title.js"
import { SessionTools } from "./tools.js"

/** Private execution results consumed by the public Session boundary. */
export interface Interface {
  readonly admitPrompt: (
    input: Session.PromptInput,
  ) => Effect.Effect<InboxSchema.Info | undefined, SessionInbox.ConflictError>
  readonly admitSynthetic: (
    input: Session.SyntheticInput,
  ) => Effect.Effect<InboxSchema.Info | undefined, SessionInbox.ConflictError>
  readonly admitCompaction: (
    input: Session.CompactInput,
  ) => Effect.Effect<InboxSchema.Info | undefined, SessionInbox.ConflictError>
  readonly active: Effect.Effect<ReadonlySet<Session.ID>>
  readonly interrupt: (sessionID: Session.ID, reason: Coordinator.InterruptReason) => Effect.Effect<void>
  readonly resume: (sessionID: Session.ID) => Effect.Effect<void, Runner.RunError>
  readonly awaitIdle: (sessionID: Session.ID) => Effect.Effect<void>
  readonly background: (sessionID: Session.ID) => Effect.Effect<boolean, SessionInbox.ConflictError>
}

/** Workspace-scoped private Session execution authority. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/SessionExecution") {}

/** Acquire all Session execution resources and start their scoped lifecycle work. */
export const sharedLayer = (
  workspaceID: Workspace.ID,
  activatePlugins: Effect.Effect<void, import("../plugin/registry-service.js").ActivationError> = Effect.void,
) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const crypto = yield* Crypto.Crypto
      const hooks = yield* PluginHooks.Service
      const jobs = yield* Job.Service
      const inbox = yield* SessionInbox.make(workspaceID).pipe(
        Effect.provideService(Database.Service, database),
        Effect.provideService(Bus.Service, bus),
        Effect.provideService(Crypto.Crypto, crypto),
      )
      // This is the sole Provider decoration in the retained Session graph.
      // Runner, one-shot generation, title work, and both compaction paths all
      // consume this same Provider service.
      const provider = Context.get(
        yield* Layer.build(
          Usage.sessionProviderLayer.pipe(Layer.provide(Layer.mergeAll(Budget.sharedLayer, Limiter.sharedLayer))),
        ) as Effect.Effect<Context.Context<Provider.Service>>,
        Provider.Service,
      )
      const runner = yield* Runner.make(database, bus, workspaceID, inbox, undefined, activatePlugins).pipe(
        Effect.provideService(Provider.Service, provider),
      )
      const titles = yield* SessionTitle.make(database, bus, workspaceID, activatePlugins).pipe(
        Effect.provideService(Provider.Service, provider),
      )
      const coordinator = yield* Coordinator.make<Runner.RunError>({
        run: runner.run,
        started: (sessionID) => bus.publish(SessionEvent.RunStarted, { sessionID }).pipe(Effect.orDie, Effect.asVoid),
        settled: (sessionID, exit, reason) => {
          const outcome = terminal(exit, reason)
          if (outcome.type === "succeeded")
            return bus.publish(SessionEvent.RunSucceeded, { sessionID }).pipe(Effect.orDie, Effect.asVoid)
          if (outcome.type === "interrupted")
            return bus
              .publish(SessionEvent.RunInterrupted, { sessionID, reason: outcome.reason })
              .pipe(Effect.orDie, Effect.asVoid)
          return bus
            .publish(SessionEvent.RunFailed, { sessionID, error: outcome.error })
            .pipe(Effect.orDie, Effect.asVoid)
        },
      })

      const compactionRequests = yield* bus.subscribe(SessionEvent.CompactionRequested)
      yield* compactionRequests.pipe(
        Stream.runForEach((event) => coordinator.wake(event.data.sessionID)),
        Effect.forkScoped,
      )
      const promotedInputs = yield* bus.subscribe(SessionEvent.InputPromoted)
      yield* promotedInputs.pipe(
        Stream.runForEach((event) =>
          titles.generateForFirstPrompt(event.data.sessionID).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterrupts(cause)
                ? Effect.interrupt
                : Effect.logError("Session title generation failed").pipe(
                    Effect.annotateLogs({ sessionID: event.data.sessionID, cause }),
                  ),
            ),
            Effect.forkScoped,
            Effect.asVoid,
          ),
        ),
        Effect.forkScoped,
      )
      const recoverable = yield* runner.recover
      yield* Effect.forEach(recoverable, coordinator.wake, { discard: true })
      yield* runner.discover.pipe(
        Effect.flatMap((ids) => Effect.forEach(ids, coordinator.wake, { discard: true })),
        Effect.repeat(Schedule.spaced("5 seconds")),
        Effect.forkScoped,
      )

      return Service.of({
        admitPrompt: Effect.fn("SessionExecution.admitPrompt")((request) =>
          Effect.uninterruptible(
            Effect.gen(function* () {
              // Prompt hooks must observe an activated plugin generation, and
              // must never mutate the caller-owned API input.
              // Required Plugin failure is fail-closed: die rather than admit without policy.
              yield* activatePlugins.pipe(Effect.orDie)
              const messageID =
                request.id ??
                (yield* crypto.randomUUIDv4.pipe(Effect.flatMap(Schema.decodeUnknownEffect(ID)), Effect.orDie))
              const prompt = {
                text: request.text,
                ...(request.agents === undefined ? {} : { agents: request.agents.map((agent) => ({ ...agent })) }),
                ...(request.metadata === undefined ? {} : { metadata: { ...request.metadata } }),
                ...(request.delivery === undefined ? {} : { delivery: request.delivery }),
                ...(request.resume === undefined ? {} : { resume: request.resume }),
              } as SessionPrompt["prompt"]
              const hooked = yield* hooks.trigger("session", "prompt", {
                sessionID: request.sessionID,
                messageID,
                prompt,
              })
              return yield* inbox.admitPrompt({ ...hooked.prompt, sessionID: request.sessionID, id: messageID })
            }).pipe(
              Effect.tap((admitted) =>
                admitted === undefined || request.resume === false ? Effect.void : coordinator.wake(request.sessionID),
              ),
            ),
          ),
        ),
        admitSynthetic: Effect.fn("SessionExecution.admitSynthetic")((request) =>
          Effect.uninterruptible(
            inbox
              .admitSynthetic(request)
              .pipe(
                Effect.tap((admitted) =>
                  admitted === undefined || request.resume === false
                    ? Effect.void
                    : coordinator.wake(request.sessionID),
                ),
              ),
          ),
        ),
        admitCompaction: Effect.fn("SessionExecution.admitCompaction")((request) =>
          Effect.uninterruptible(
            inbox
              .admitCompaction(request)
              .pipe(
                Effect.tap((admitted) => (admitted === undefined ? Effect.void : coordinator.wake(request.sessionID))),
              ),
          ),
        ),
        active: coordinator.active.pipe(Effect.withSpan("Session.active")),
        interrupt: (sessionID, reason) => coordinator.interrupt(sessionID, reason).pipe(Effect.asVoid),
        resume: coordinator.resume,
        awaitIdle: coordinator.awaitIdle,
        background: Effect.fn("SessionExecution.background")(function* (sessionID) {
          const backgrounded = yield* jobs.backgroundAll({ sessionID })
          if (backgrounded.length === 0) return true
          const admitted = yield* inbox.admitSynthetic({
            sessionID,
            text: [
              "User requested that active blocking work be moved to the background.",
              "",
              "Backgrounded work:",
              ...backgrounded.map((job) => `- ${job.type}: ${job.title && job.title.length > 0 ? job.title : job.id}`),
              "",
              "The backgrounded work is still unfinished. Move on to other work if you can. If there is nothing else useful to do, finish your response. Do not wait, sleep, poll, or report the backgrounded work as complete until a later completion notification is added to the conversation.",
            ].join("\n"),
          })
          if (admitted === undefined) return false
          yield* coordinator.wake(sessionID)
          return true
        }),
      })
    }),
  )

/** Isolated execution graph for focused tests. */
export const layer = (
  workspaceID: Workspace.ID,
  activatePlugins: Effect.Effect<void, import("../plugin/registry-service.js").ActivationError> = Effect.void,
) =>
  sharedLayer(workspaceID, activatePlugins).pipe(Layer.provide(Layer.mergeAll(Budget.stateMemory, Limiter.stateMemory)))

const terminal = (
  exit: Exit.Exit<void, Runner.RunError>,
  reason?: Coordinator.InterruptReason,
):
  | { readonly type: "succeeded" }
  | { readonly type: "interrupted"; readonly reason: Coordinator.InterruptReason }
  | { readonly type: "failed"; readonly error: SessionError.Error } => {
  if (Exit.isSuccess(exit)) return { type: "succeeded" }
  if (Cause.hasInterrupts(exit.cause)) return { type: "interrupted", reason: reason ?? "shutdown" }
  const failure = Cause.squash(exit.cause)
  if (failure instanceof Runner.RunError) return { type: "failed", error: failure.error }
  return { type: "failed", error: SessionError.Internal.make({ message: "Session run failed" }) }
}

/** Declare the complete private Session execution graph. */
export const workspaceNodes = <E>(input: {
  readonly workspaceID: Workspace.ID
  readonly activatePlugins?: Effect.Effect<void, import("../plugin/registry-service.js").ActivationError>
  readonly agent: WorkspaceNode<Agent.Service, E>
  readonly bus: WorkspaceNode<Bus.Service, E>
  readonly crypto: GlobalNode<Crypto.Crypto, E>
  readonly config: WorkspaceNode<Config.Service, E>
  readonly database: GlobalNode<Database.Service, E>
  readonly instructionEntry: WorkspaceNode<InstructionEntry.Service, E>
  readonly instructionDiscovery: WorkspaceNode<import("../instruction-discovery.js").InstructionDiscovery.Service, E>
  readonly job: WorkspaceNode<Job.Service, E>
  readonly model: GlobalNode<Model.Service, E>
  readonly modelResolver: WorkspaceNode<ModelResolver.Service, E>
  readonly pluginHooks: WorkspaceNode<PluginHooks.Service, E>
  readonly permission: WorkspaceNode<Permission.Service, E>
  readonly provider: GlobalNode<Provider.Service, E>
  readonly sessionTools: WorkspaceNode<SessionTools.Service, E>
  readonly skillInstruction: WorkspaceNode<SkillInstruction.Service, E>
  readonly storage: GlobalNode<Storage.Service, E>
  readonly toolOutput: WorkspaceNode<ToolOutput.Service, E>
  readonly reference: WorkspaceNode<import("../reference.js").Reference.Service, E>
  readonly outboundMCP: WorkspaceNode<import("../mcp.js").Mcp.Service, E>
}) =>
  makeWorkspaceNode({
    service: Service,
    layer: sharedLayer(input.workspaceID, input.activatePlugins),
    deps: [
      input.agent,
      input.bus,
      input.crypto,
      input.config,
      input.database,
      input.instructionEntry,
      input.instructionDiscovery,
      input.job,
      input.modelResolver,
      input.pluginHooks,
      input.permission,
      input.provider,
      input.sessionTools,
      input.skillInstruction,
      input.storage,
      input.toolOutput,
      input.reference,
      input.outboundMCP,
    ],
  })

/** Canonical private Session execution graph. */
export const node = makeWorkspaceNode({
  service: Service,
  layer: Layer.unwrap(
    Effect.gen(function* () {
      const { workspaceID } = yield* Actor.Binding.Service
      const activation = yield* PluginActivation.Service
      return sharedLayer(workspaceID, activation.awaitActivation)
    }),
  ),
  deps: [
    Actor.binding,
    Agent.node,
    Bus.node,
    LayerNodePlatform.crypto,
    Config.node,
    Database.node,
    InstructionEntry.node,
    InstructionDiscovery.node,
    Job.node,
    ModelResolver.node,
    Routing.node,
    PluginHooks.node,
    SessionPermission.node,
    Provider.node,
    Usage.node,
    User.node,
    ServiceAccount.node,
    Budget.stateNode,
    Limiter.stateNode,
    SessionTools.node,
    SkillInstruction.node,
    Storage.node,
    ToolOutput.node,
    Reference.node,
    Mcp.node,
    PluginActivation.node,
  ],
})
