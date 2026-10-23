export * as Runner from "./runner.js"

import { Message, SystemPart, ToolChoice, ToolDefinition } from "@opencode-ai/ai/schema/messages"
import { Assistant, ID } from "@bymorning/schema/message"
import { ScheduledTask } from "@bymorning/schema/scheduled-task"
import { Session } from "@bymorning/schema/session"
import { SessionError } from "@bymorning/schema/session-error"
import { SessionEvent } from "@bymorning/schema/session-event"
import { and, eq, isNull } from "drizzle-orm"
import { Agent } from "@bymorning/core/agent"
import { Config } from "@bymorning/core/config"
import { Provider } from "@bymorning/core/provider"
import { Cause, Crypto, Effect, Exit, Fiber, Match, Ref, Result, Schema, Scope, Stream } from "effect"
import { Bus } from "../bus.js"
import { InstructionEntry } from "../instruction-entry.js"
import { Mcp } from "../mcp.js"
import { ProjectDirectory } from "../project-directory.js"
import { Reference } from "../reference.js"
import { SkillInstruction } from "../skill-instruction.js"
import { Storage } from "../storage.js"
import { ToolOutput } from "../tool-output.js"
import { Permission } from "../permission.js"
import { PluginHooks } from "../plugin/hooks.js"
import { SessionTable, type Database } from "../database.js"
import type { Interface as Inbox } from "./inbox.js"
import { SessionMessage } from "./message.js"
import { SessionTools } from "./tools.js"
import { SessionRecorder } from "./recorder.js"
import { fromHistory } from "./provider-message.js"
import { providerSessionError } from "./provider-error.js"
import { prompt, reached } from "./limit.js"
import { InstructionState } from "./instruction-state.js"
import { SessionContext } from "./context.js"
import { SessionCompaction } from "./compaction.js"
import { effectiveRules } from "./permission.js"
import { SessionModelRequest } from "./model-request.js"
import { ModelResolver } from "../model-resolver.js"
import { SessionHttp } from "./http.js"
import { SessionRetry } from "./retry.js"
import { SessionRouteJudge } from "./route-judge.js"
import { Routing } from "../routing.js"
import type { Message as SessionMessageSchema } from "@bymorning/schema/message"

/** An Agent, Provider, or Model selection cannot be resolved for execution. */
export class ResolutionError extends Schema.TaggedError<ResolutionError>()("Session.Runner.ResolutionError", {
  message: Schema.String,
}) {}

/** A Session run stopped after durably recording its terminal domain failure. */
export class RunError extends Schema.TaggedError<RunError>()("Session.Runner.RunError", {
  error: SessionError.Error,
}) {}

const rejected = (cause: Cause.Cause<never>) =>
  !Cause.hasInterrupts(cause) &&
  cause.reasons.some(
    (reason) =>
      Cause.isDieReason(reason) &&
      reason.defect instanceof Permission.RejectedError &&
      reason.defect.feedback === undefined,
  )

/** Run all currently durable work for one Session. */
export interface Interface {
  readonly run: (sessionID: Session.ID) => Effect.Effect<void, RunError>
  readonly recover: Effect.Effect<ReadonlySet<Session.ID>>
  readonly discover: Effect.Effect<ReadonlySet<Session.ID>>
}

/** @internal Deterministic synchronization at the active-message publication boundary. */
interface TestHooks {
  readonly beforeActivate?: (messageID: ID) => Effect.Effect<void>
  readonly succeedTool?: SessionRecorder.Interface["succeedTool"]
  readonly beforeFinishTools?: (recorder: SessionRecorder.Interface) => Effect.Effect<void>
}

/** Construct the private durable Session work loop. */
export const make = (
  database: Database.Interface,
  bus: Bus.Interface,
  workspaceID: import("@bymorning/schema/workspace").Workspace.ID,
  inbox: Inbox,
  testHooks?: TestHooks,
  activatePlugins: Effect.Effect<void, import("../plugin/registry-service.js").ActivationError> = Effect.void,
): Effect.Effect<
  Interface,
  never,
  | Agent.Service
  | Config.Service
  | Crypto.Crypto
  | InstructionEntry.Service
  | import("../instruction-discovery.js").InstructionDiscovery.Service
  | Mcp.Service
  | Provider.Service
  | Reference.Service
  | PluginHooks.Service
  | Permission.Service
  | SessionTools.Service
  | SkillInstruction.Service
  | Storage.Service
  | ToolOutput.Service
  | ModelResolver.Service
> =>
  Effect.gen(function* () {
    const providers = yield* Provider.Service
    const hooks = yield* PluginHooks.Service
    const storage = yield* Storage.Service
    const toolOutput = yield* ToolOutput.Service
    const crypto = yield* Crypto.Crypto
    const resolveTools = yield* SessionTools.Service
    const agents = yield* Agent.Service
    const configuration = yield* Config.Service
    const permission = yield* Permission.Service
    const resolver = yield* ModelResolver.Service
    const context = yield* SessionContext.make
    const compaction = yield* SessionCompaction.make(database, bus, workspaceID)
    const failResolution = (message: string) => new ResolutionError({ message })
    const routing = yield* Effect.serviceOption(Routing.Service)
    const resolveStep = Effect.fn("Session.Runner.resolve")(function* (assistant: Assistant, currentStep: number) {
      const session = (yield* database
        .use("Session.Runner.selection", (db) =>
          db
            .select({
              projectID: SessionTable.projectID,
              parentID: SessionTable.parentID,
              userID: SessionTable.userID,
              scheduledTaskID: SessionTable.scheduledTaskID,
            })
            .from(SessionTable)
            .where(and(eq(SessionTable.workspaceID, workspaceID), eq(SessionTable.id, assistant.sessionID)))
            .limit(1),
        )
        .pipe(Effect.orDie))[0]
      if (session === undefined) return yield* failResolution("Active Session missing")
      const agent = yield* agents.get(assistant.agent).pipe(
        Effect.filterOrFail(
          (agent): agent is NonNullable<typeof agent> => agent !== undefined,
          () => failResolution(`Agent selection not found: ${assistant.agent}`),
        ),
      )
      const history = (yield* SessionMessage.context(database, workspaceID, assistant.sessionID)).filter(
        (message) => message.id !== assistant.id,
      )
      // Routing decides once per participant turn; Tool-loop continuations reuse that turn's decision.
      const decided = turnDecision(history, assistant.model)
      // Provider system text is assembled after resolution; estimate it from the Agent's instructions
      // and the persisted instruction baseline so context conditions and Tier sizes account for it.
      const system =
        decided === undefined
          ? [agent.instructions, yield* InstructionState.estimate(database, assistant.sessionID)]
              .filter((text) => text.length > 0)
              .map((text) => SystemPart.make(text))
          : undefined
      const judgeContext = {
        sessionID: assistant.sessionID,
        ...(session.projectID === null || session.projectID === undefined ? {} : { projectID: session.projectID }),
        messageID: assistant.id,
        agent: assistant.agent,
      }
      const request = yield* SessionModelRequest.plan({
        purpose: "assistant",
        sessionID: assistant.sessionID,
        projectID: session.projectID,
        messageID: assistant.id,
        agent: assistant.agent,
        requestedModel: assistant.model,
        ...(decided !== undefined
          ? { decided }
          : {
              digest: Routing.digest(fromHistory(history, { continuation: false }), system),
              tools: completedTools(history),
              judge: SessionRouteJudge.make({ providers, hooks, permission, bus, resolver }, judgeContext),
            }),
      }).pipe(
        SessionModelRequest.withRouting(routing),
        Effect.provideService(Provider.Service, providers),
        Effect.provideService(PluginHooks.Service, hooks),
        Effect.provideService(Permission.Service, permission),
        Effect.provideService(Bus.Service, bus),
        Effect.provideService(ModelResolver.Service, resolver),
        Effect.mapError((failure) => failResolution(failure.message)),
      )
      // Unattended Scheduled Task runs are capped so Tools are withheld and the loop ends instead of running forever.
      const steps =
        session.scheduledTaskID === null ? agent.steps : Math.min(agent.steps ?? ScheduledTask.RunSteps, ScheduledTask.RunSteps)
      const cutoff = reached(steps, currentStep)
      return { agent, request, cost: request.resolved.selection.info.cost, cutoff, session }
    })
    const run = Effect.fn("Session.Runner.run")(
      function* (sessionID: Session.ID) {
        const activeID = yield* Ref.make<ID | undefined>(undefined)
        // One Recorder scope per step. Closing it writes the step's pending partial output,
        // so it closes before the next step starts and, below, before an interrupted run
        // settles its active Message.
        const recording = yield* Ref.make<Scope.Closeable | undefined>(undefined)
        const closeRecording = Ref.getAndSet(recording, undefined).pipe(
          Effect.flatMap((scope) => (scope === undefined ? Effect.void : Scope.close(scope, Exit.void))),
        )
        const openRecorder = (input: Parameters<typeof SessionRecorder.make>[0]) =>
          Effect.gen(function* () {
            yield* closeRecording
            const scope = yield* Scope.make()
            yield* Ref.set(recording, scope)
            return yield* SessionRecorder.make(input).pipe(
              Effect.provideService(ToolOutput.Service, toolOutput),
              Scope.provide(scope),
            )
          })
        const execute = Effect.gen(function* () {
          let continuation = yield* SessionMessage.needsContinuation(database, workspaceID, sessionID)
          let currentStep = 1
          let retryAssistant: Assistant | undefined
          let providerRetry: { readonly assistant: Assistant; readonly controller: SessionRetry.Interface } | undefined
          let overflowRetried = false
          // Set after a provider rejects continuation state it issued earlier (an
          // aggregator may route a later request to a different upstream account).
          let continuationRejected = false
          const activate = (messageID: ID) =>
            Effect.gen(function* () {
              if (testHooks?.beforeActivate !== undefined) yield* testHooks.beforeActivate(messageID)
              yield* Ref.set(activeID, messageID)
            })
          while (true) {
            const retry = retryAssistant
            retryAssistant = undefined
            const retrying = providerRetry
            providerRetry = undefined
            const started = yield* Effect.uninterruptibleMask((restore) =>
              retrying !== undefined
                ? Effect.succeed({ type: "prompt" as const, assistant: retrying.assistant, workspaceID })
                : retry !== undefined
                  ? Effect.succeed({ type: "prompt" as const, assistant: retry, workspaceID })
                  : restore(
                      continuation
                        ? SessionMessage.continueExecution(
                            database,
                            bus,
                            crypto,
                            workspaceID,
                            sessionID,
                            activate,
                          ).pipe(
                            Effect.map((started) =>
                              started === undefined ? undefined : { type: "prompt" as const, ...started },
                            ),
                          )
                        : inbox.deliver(sessionID, activate),
                    ),
            )
            if (started === undefined) return
            if (started.type === "compaction") {
              const outcome = yield* Effect.gen(function* () {
                yield* activatePlugins.pipe(
                  Effect.mapError(
                    () =>
                      new RunError({
                        error: SessionError.Internal.make({ message: "Required inference Plugin is unavailable" }),
                      }),
                  ),
                )
                return yield* compaction.compactManual({
                  compaction: started.compaction,
                  messages: yield* SessionMessage.context(database, workspaceID, sessionID),
                })
              }).pipe(Effect.onInterrupt(() => compaction.abort(started.compaction)))
              if (outcome.status === "failed") return yield* new RunError({ error: outcome.error })
              continuation = yield* SessionMessage.needsContinuation(database, workspaceID, sessionID)
              continue
            }
            yield* activatePlugins.pipe(
              Effect.mapError(
                () =>
                  new RunError({
                    error: SessionError.Internal.make({ message: "Required inference Plugin is unavailable" }),
                  }),
              ),
            )
            if (retry === undefined) overflowRetried = false
            continuation = true
            const { assistant } = started
            const retryController =
              retrying?.controller ??
              (yield* SessionRetry.make(
                (data) =>
                  SessionMessage.updateAssistant(database, workspaceID, data.messageID, (message) =>
                    Assistant.make({ ...message, retry: { attempt: data.attempt, at: data.at, error: data.error } }),
                  ).pipe(Effect.andThen(bus.publish(SessionEvent.RetryScheduled, data)), Effect.orDie, Effect.asVoid),
                sessionID,
              ))
            const id = assistant.id
            const resolution = yield* resolveStep(assistant, currentStep).pipe(Effect.result)
            if (Result.isFailure(resolution)) {
              const recorder = yield* openRecorder({ database, events: bus, assistant, workspaceID })
              const error = SessionError.Provider.make({ message: resolution.failure.message })
              yield* recorder.fail(error)
              return yield* new RunError({ error })
            }
            const { agent, request: modelRequest, cost, cutoff, session } = resolution.success
            const model = modelRequest.resolved.selection
            const permissions = effectiveRules(
              session.parentID,
              agent.permissions,
              (yield* configuration.get).permissions,
              session.userID,
            )
            const effectiveAssistant = Assistant.make({
              ...assistant,
              model: modelRequest.model,
              ...(sameModel(modelRequest.requestedModel, modelRequest.model)
                ? {}
                : { requestedModel: modelRequest.requestedModel }),
              ...(modelRequest.route === undefined ? {} : { route: modelRequest.route }),
            })
            const recorder = yield* openRecorder({
              database,
              events: bus,
              assistant: effectiveAssistant,
              cost,
              workspaceID,
            })
            const projectDirectory =
              session.projectID === undefined
                ? undefined
                : yield* ProjectDirectory.Service.pipe(
                    Effect.provide(ProjectDirectory.layer(workspaceID, session.projectID)),
                    Effect.provideService(Storage.Service, storage),
                    Effect.provideService(Bus.Service, bus),
                  )
            const availableTools = cutoff
              ? undefined
              : yield* resolveTools
                  .resolve({
                    sessionID,
                    projectID: session.projectID,
                    agent: assistant.agent,
                    messageID: id,
                    requestedModel: modelRequest.requestedModel,
                    model: modelRequest.model,
                    permissions,
                    recorder,
                  })
                  .pipe(
                    projectDirectory === undefined
                      ? Effect.provide(ProjectDirectory.layer(workspaceID, session.projectID))
                      : Effect.provideService(ProjectDirectory.Service, projectDirectory),
                    Effect.provideService(Storage.Service, storage),
                    Effect.provideService(Bus.Service, bus),
                  )
                  .pipe(
                    Effect.mapError(
                      (error) =>
                        new RunError({
                          error: SessionError.Tool.make({ message: error.message }),
                        }),
                    ),
                  )
            const sources = yield* context.load(sessionID, permissions, availableTools, workspaceID, session.projectID)
            const available = yield* InstructionState.prepare(database, bus, sources, sessionID).pipe(
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.mapError((error) =>
                error._tag === "Instruction.InitializationError"
                  ? error
                  : new RunError({
                      error: SessionError.Internal.make({ message: "Unable to persist Session instructions" }),
                    }),
              ),
              Effect.as(true),
              Effect.catchTag("Instruction.InitializationError", () => Effect.succeed(false)),
            )
            if (!available) {
              const error = SessionError.Internal.make({ message: "Instructions are temporarily unavailable" })
              yield* recorder.fail(error)
              return yield* new RunError({ error })
            }
            const history = (yield* SessionMessage.context(database, workspaceID, sessionID)).filter(
              (message) => message.id !== id,
            )
            if (compaction.required({ messages: history, model })) {
              const outcome = yield* compaction.compact({
                sessionID,
                agent: assistant.agent,
                requestedModel: Routing.isAuto(assistant.model) ? modelRequest.model : assistant.model,
                projectID: session.projectID,
                messages: history,
                model,
              })
              if (outcome.status === "completed") {
                yield* SessionMessage.interrupt(database, bus, workspaceID, id)
                retryAssistant = yield* SessionMessage.restartExecution(database, bus, crypto, workspaceID, assistant)
                yield* Ref.set(activeID, retryAssistant.id)
                continue
              }
            }
            yield* SessionMessage.updateAssistant(database, workspaceID, id, (message) =>
              Assistant.make({
                ...message,
                model: modelRequest.model,
                ...(sameModel(modelRequest.requestedModel, modelRequest.model)
                  ? {}
                  : { requestedModel: modelRequest.requestedModel }),
                ...(modelRequest.route === undefined ? {} : { route: modelRequest.route }),
              }),
            )
            yield* bus
              .publish(SessionEvent.ExecutionModelRouted, {
                sessionID,
                messageID: id,
                requestedModel: modelRequest.requestedModel,
                model: modelRequest.model,
                ...(modelRequest.route === undefined ? {} : { route: modelRequest.route }),
              })
              .pipe(Effect.orDie)
            const baseline = yield* InstructionState.initial(database, sessionID, sources)
            const systemParts = [agent.instructions, baseline]
              .filter((text) => text.length > 0)
              .map((text) => SystemPart.make(text))
            const definitions = availableTools?.definitions ?? []
            const registry = new Map(definitions.map((definition) => [definition.name, definition]))
            const given = new Map(
              definitions.map(
                (definition) =>
                  [{ description: definition.description, input: definition.inputSchema }, definition] as const,
              ),
            )
            const hookContext = {
              sessionID,
              messageID: id,
              agent: assistant.agent,
              requestedModel: modelRequest.requestedModel,
              model: modelRequest.model,
              system: systemParts,
              messages: [
                ...fromHistory(history, { continuation: !continuationRejected, model: modelRequest.model }),
                ...(cutoff ? [Message.assistant(prompt)] : []),
              ],
              tools: Object.fromEntries(Array.from(given, ([value, definition]) => [definition.name, value])),
              permissions,
            }
            const request = yield* hooks.trigger("session", "context", hookContext)
            const hooked = Object.entries(request.tools).flatMap(([name, definition]) => {
              const original = given.get(definition) ?? registry.get(name)
              if (original === undefined) return []
              return [[name, { definition, original }] as const]
            })
            const originalNames = new Map(hooked.map(([name, value]) => [name, value.original.name]))
            const providerContext = {
              purpose: modelRequest.purpose,
              sessionID: modelRequest.sessionID,
              messageID: modelRequest.messageID,
              agent: modelRequest.agent,
              requestedModel: modelRequest.requestedModel,
              model: modelRequest.model,
            }
            const http = yield* SessionHttp.middleware(providerContext).pipe(
              Effect.provideService(PluginHooks.Service, hooks),
            )
            let emitted = false
            const result = yield* providers
              .stream({
                context: providerContext,
                selection: model,
                runtimeModel: modelRequest.resolved.runtimeModel,
                authentication: modelRequest.resolved.authentication,
                http,
                messages: request.messages,
                tools: hooked.map(([name, value]) =>
                  ToolDefinition.make({
                    name,
                    description: value.definition.description,
                    inputSchema: value.definition.input,
                    outputSchema: value.original.outputSchema,
                  }),
                ),
                toolChoice: cutoff ? ToolChoice.make("none") : ToolChoice.make("auto"),
                ...(request.system.length === 0 ? {} : { system: request.system }),
              })
              .pipe(
                Stream.runForEach((event) => {
                  if (event.type !== "step-start" && event.type !== "step-finish" && event.type !== "finish")
                    emitted = true
                  return recorder.write(event)
                }),
                Effect.andThen(recorder.finishStream),
                Effect.result,
              )
            if (Result.isFailure(result)) {
              if (result.failure._tag === "Provider.FailureError" && !emitted) {
                const decision = yield* retryController.decide(result.failure)
                if (decision !== undefined) {
                  const error = providerSessionError(result.failure)
                  const retry = yield* hooks.trigger("session", "retry", {
                    sessionID,
                    agent: assistant.agent,
                    model: modelRequest.model,
                    error,
                    attempt: decision.attempt,
                    decision: { retry: true, delay: decision.delay },
                  })
                  if (!retry.decision.retry) {
                    yield* recorder.fail(error, recorder.state().activeStep)
                    return yield* new RunError({ error })
                  }
                  providerRetry = { assistant, controller: retryController }
                  yield* retryController.wait({
                    decision: {
                      ...decision,
                      delay:
                        Number.isFinite(retry.decision.delay) && retry.decision.delay >= 0
                          ? Math.ceil(retry.decision.delay)
                          : decision.delay,
                    },
                    messageID: id,
                    error,
                  })
                  continue
                }
              }
              if (
                result.failure._tag === "Provider.FailureError" &&
                !emitted &&
                !continuationRejected &&
                rejectsContinuation(result.failure)
              ) {
                continuationRejected = true
                yield* Effect.logWarning(
                  "Provider rejected replayed continuation state; retrying with visible history",
                ).pipe(Effect.annotateLogs({ sessionID, messageID: id, model: modelRequest.model }))
                continue
              }
              if (result.failure._tag === "Provider.ContextOverflowError" && !emitted && !overflowRetried) {
                overflowRetried = true
                const error = SessionError.Provider.make({ message: "Provider context window exceeded" })
                yield* recorder.fail(error)
                const outcome = yield* compaction.compact({
                  sessionID,
                  projectID: session.projectID,
                  agent: assistant.agent,
                  requestedModel: Routing.isAuto(assistant.model) ? modelRequest.model : assistant.model,
                  messages: history,
                  model,
                })
                if (outcome.status === "completed") {
                  retryAssistant = yield* SessionMessage.restartExecution(database, bus, crypto, workspaceID, assistant)
                  yield* Ref.set(activeID, retryAssistant.id)
                  continue
                }
                return yield* new RunError({ error })
              }
              const error = Match.valueTags(result.failure, {
                "Session.Recorder.OrderError": (failure) => SessionError.Internal.make({ message: failure.message }),
                "Session.Recorder.ProviderError": (failure) => SessionError.Provider.make({ message: failure.message }),
                "Provider.FailureError": providerSessionError,
                "Provider.ContextOverflowError": () =>
                  SessionError.Provider.make({ message: "Provider context window exceeded" }),
              })
              yield* recorder.fail(error, recorder.state().activeStep)
              return yield* new RunError({ error })
            }
            yield* SessionMessage.updateAssistant(database, workspaceID, id, (message, now) =>
              Assistant.make({ ...message, time: { ...message.time, streamed: now } }),
            )
            yield* bus
              .publish(SessionEvent.ExecutionStreamed, {
                sessionID,
                messageID: id,
                attempt: retryController.attempt(),
              })
              .pipe(Effect.orDie)
            const record = recorder.state()
            const finish = record.finish ?? (record.calls.length > 0 ? "tool-calls" : "stop")
            if (finish === "error" || finish === "content-filter") {
              const error = SessionError.Provider.make({
                message:
                  finish === "content-filter"
                    ? "The response was blocked by the provider's content filter"
                    : "Provider execution failed",
              })
              yield* recorder.fail(error, record.activeStep ?? record.lastStep)
              return yield* new RunError({ error })
            }
            const toolOutcomes = yield* Effect.forEach(
              record.calls,
              (call) =>
                Effect.uninterruptibleMask((restore) =>
                  Effect.gen(function* () {
                    // The provider has already performed this call before the host receives it, so
                    // SessionTools cannot safely apply an ask, deny, or stateful combine decision.
                    // Provider-hosted tools therefore remain outside Policy v2 admission until the
                    // provider protocol offers a pre-execution authorization boundary.
                    if (call.providerExecuted === true) return { type: "completed" as const }
                    if (cutoff) {
                      yield* recorder.failTool(
                        call.id,
                        SessionError.Tool.make({ message: "Tools are disabled after the maximum agent steps" }),
                      )
                      return { type: "completed" as const }
                    }
                    if (availableTools === undefined) return yield* Effect.die(new Error("Tool snapshot missing"))
                    const originalName = originalNames.get(call.name)
                    if (originalName === undefined) {
                      yield* recorder.failTool(
                        call.id,
                        SessionError.Tool.make({ message: `Tool is unavailable for this model request: ${call.name}` }),
                      )
                      return { type: "completed" as const }
                    }
                    const execution = yield* restore(
                      availableTools.execute({
                        call: { ...call, name: originalName },
                        definitions: new Map(
                          hooked.map(([name, value]) => [
                            name,
                            ToolDefinition.make({
                              name,
                              description: value.definition.description,
                              inputSchema: value.definition.input,
                              outputSchema: value.original.outputSchema,
                            }),
                          ]),
                        ),
                      }),
                    ).pipe(
                      Effect.result,
                      Effect.catchCauseIf(rejected, () => Effect.void),
                    )
                    if (execution === undefined) return { type: "declined" as const, call }
                    if (Result.isFailure(execution)) {
                      yield* recorder.failTool(call.id, SessionError.Tool.make({ message: execution.failure.message }))
                      return { type: "completed" as const }
                    }
                    const published = yield* (testHooks?.succeedTool ?? recorder.succeedTool)(
                      call.id,
                      execution.success,
                    ).pipe(Effect.result)
                    if (Result.isSuccess(published)) return { type: "completed" as const }
                    return {
                      type: "failed" as const,
                      error: Match.valueTags(published.failure, {
                        "Session.Recorder.OrderError": (failure) =>
                          SessionError.Internal.make({ message: failure.message }),
                      }),
                    }
                  }),
                ),
              { concurrency: "unbounded" },
            )
            const stopped = toolOutcomes.find((outcome) => outcome.type !== "completed")
            if (stopped?.type === "declined") {
              yield* recorder.failTool(
                stopped.call.id,
                SessionError.Aborted.make({ message: "The user declined this tool call" }),
              )
              const error = SessionError.Aborted.make({ message: "Step interrupted" })
              yield* recorder.fail(error)
              return yield* new RunError({ error })
            }
            if (stopped?.type === "failed") {
              yield* recorder.fail(stopped.error, recorder.state().activeStep)
              return yield* new RunError({ error: stopped.error })
            }
            if (testHooks?.beforeFinishTools !== undefined) yield* testHooks.beforeFinishTools(recorder)
            const settled = yield* recorder.finishTools.pipe(Effect.result)
            if (Result.isFailure(settled)) {
              const error = SessionError.Provider.make({ message: settled.failure.message })
              yield* recorder.fail(error, recorder.state().activeStep)
              return yield* new RunError({ error })
            }
            yield* SessionMessage.complete(database, bus, workspaceID, sessionID, id, finish)
            overflowRetried = false
            yield* Ref.set(activeID, undefined)
            const continues = yield* SessionMessage.needsContinuation(database, workspaceID, sessionID)
            if (cutoff || !continues) {
              continuation = continues
              currentStep = 1
            } else currentStep++
          }
        }).pipe(Effect.provideService(Crypto.Crypto, crypto))
        const interruptActive = Ref.get(activeID).pipe(
          Effect.flatMap((messageID) => {
            if (messageID === undefined) return Effect.void
            return SessionMessage.interrupt(database, bus, workspaceID, messageID).pipe(Effect.orDie, Effect.asVoid)
          }),
        )
        yield* Effect.uninterruptibleMask((restore) =>
          restore(execute).pipe(
            Effect.exit,
            Effect.flatMap((exit) => {
              // Database transactions restore interruptibility, so persist the pending
              // partial output and the terminal message on fresh fibers before the
              // interrupted owner can settle. The recording closes first so interruption
              // keeps every delta the Bus already delivered.
              const settle = closeRecording.pipe(Effect.forkChild, Effect.flatMap(Fiber.join))
              if (Exit.isSuccess(exit)) return settle.pipe(Effect.as(exit.value))
              return settle.pipe(
                Effect.andThen(
                  Cause.hasInterrupts(exit.cause)
                    ? interruptActive.pipe(Effect.forkChild, Effect.flatMap(Fiber.join))
                    : Effect.void,
                ),
                Effect.andThen(Effect.failCause(exit.cause)),
              )
            }),
          ),
        )
      },
      (effect) => effect.pipe(Effect.catchTag("Session.NotFoundError", Effect.die)),
    )
    const discover = Effect.fn("Session.Runner.discover")(function* () {
      const [admitted, continued] = yield* Effect.all([inbox.list, SessionMessage.continuations(database, workspaceID)])
      const candidates = new Set([...admitted, ...continued])
      if (candidates.size === 0) return candidates
      const roots = yield* database
        .use("Session.Runner.discoverRoots", (db) =>
          db
            .select({ id: SessionTable.id })
            .from(SessionTable)
            .where(and(eq(SessionTable.workspaceID, workspaceID), isNull(SessionTable.parentID))),
        )
        .pipe(Effect.orDie)
      return new Set(roots.flatMap((row) => (candidates.has(row.id) ? [row.id] : [])))
    })
    const recover = Effect.gen(function* () {
      const interrupted = yield* SessionMessage.interruptStale(database, bus, workspaceID)
      yield* Effect.forEach(
        interrupted,
        (sessionID) =>
          inbox
            .admitSynthetic({
              sessionID,
              text: "The server restarted while you were working. Continue from where you left off without repeating completed work.",
              description: "Continuing after restart",
            })
            .pipe(Effect.orDie),
        { discard: true },
      )
      return yield* discover()
    })
    return { run, recover, discover: discover() }
  })

/**
 * The decision of the current participant turn when this step continues its Tool loop: the newest
 * assistant contribution after the latest participant Message, provided it was requested under the
 * same Model reference. A new participant Message, or a changed selection, starts a new decision.
 */
const turnDecision = (
  history: ReadonlyArray<SessionMessageSchema>,
  requested: import("@bymorning/schema/model").Ref,
) => {
  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index]!
    if (message.type === "user") return undefined
    if (message.type !== "assistant") continue
    if (!sameModel(message.requestedModel ?? message.model, requested)) return undefined
    return { model: message.model, route: message.route ?? ({ cause: "none" } as const) }
  }
  return undefined
}

/** Names of Tools that completed earlier in the Session, derived from durable history. */
const completedTools = (history: ReadonlyArray<SessionMessageSchema>) =>
  new Set(
    history.flatMap((message) =>
      message.type === "assistant"
        ? message.content.flatMap((part) => (part.type === "tool" && part.state.status === "completed" ? [part.name] : []))
        : [],
    ),
  )

const sameModel = (left: import("@bymorning/schema/model").Ref, right: import("@bymorning/schema/model").Ref) =>
  left.provider === right.provider &&
  left.id === right.id &&
  (left.variant === undefined || left.variant === "default" ? "default" : left.variant) ===
    (right.variant === undefined || right.variant === "default" ? "default" : right.variant)

/** An upstream could not verify opaque continuation state (encrypted reasoning, thinking signatures) that it or a peer issued earlier. */
function rejectsContinuation(failure: Provider.FailureError) {
  const text = `${failure.message ?? ""} ${failure.responseBody ?? ""}`
  return (
    text.includes("invalid_encrypted_content") ||
    /encrypted content .* could not be verified/i.test(text) ||
    /invalid [`'"]?signature[`'"]? in [`'"]?(redacted_)?thinking[`'"]? block/i.test(text)
  )
}
