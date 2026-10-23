export * as SessionCompaction from "./compaction.js"

import { Message, ToolChoice } from "@opencode-ai/ai/schema/messages"
import { Compaction, CompactionCompleted, CompactionFailed, CompactionRunning } from "@bymorning/schema/message"
import type { Message as SessionMessage, ToolContent } from "@bymorning/schema/message"
import type { Agent } from "@bymorning/schema/agent"
import type { Model as ModelSchema } from "@bymorning/schema/model"
import { Session } from "@bymorning/schema/session"
import { SessionError } from "@bymorning/schema/session-error"
import { SessionEvent } from "@bymorning/schema/session-event"
import { context, empty, type Usage } from "@bymorning/schema/usage"
import type { Workspace } from "@bymorning/schema/workspace"
import type { Project } from "@bymorning/schema/project"
import { and, eq } from "drizzle-orm"
import { Array, Context, Crypto, Effect, Option, Schema, Stream } from "effect"
import { Bus } from "../bus.js"
import { Config } from "../config.js"
import { type Database, SessionMessageTable, SessionTable } from "../database.js"
import type { Model } from "../model.js"
import { Provider } from "../provider.js"
import { providerSessionError } from "./provider-error.js"
import { PluginHooks } from "../plugin/hooks.js"
import { Permission } from "../permission.js"
import { add, normalize } from "./usage.js"
import { SessionModelRequest } from "./model-request.js"
import { Routing } from "../routing.js"
import { ModelResolver } from "../model-resolver.js"
import { SessionHttp } from "./http.js"
import { allocate } from "./position.js"
import { InstructionState } from "./instruction-state.js"

const OUTPUT_TOKEN_MAX = 32_000
const TOOL_OUTPUT_MAX_CHARS = 2_000
const SUMMARY_TEMPLATE = `Output exactly this Markdown structure and keep every section:
## Objective
- [one or two brief sentences describing the user's goal]

## Important Details
- [constraints, decisions, facts, or "(none)"]

## Work State
### Completed
- [completed work or "(none)"]
### Active
- [active work or "(none)"]
### Blocked
- [blockers or "(none)"]

## Next Move
1. [immediate concrete action or "(none)"]
2. [next action or "(none)"]

## Relevant Files
- [path and why it matters, or "(none)"]

Use terse bullets. Preserve exact paths, symbols, commands, errors, URLs, and identifiers. Do not mention compaction or summarization.`

export interface RequiredInput {
  readonly messages: readonly SessionMessage[]
  readonly model: Model.Selection
}
export interface AutoInput extends RequiredInput {
  readonly sessionID: Session.ID
  readonly projectID: Project.ID
  readonly agent: Agent.ID
  readonly requestedModel: ModelSchema.Ref
}
export interface ManualInput {
  readonly compaction: CompactionRunning
  readonly messages: readonly SessionMessage[]
}
export type Outcome =
  { readonly status: "completed" } | { readonly status: "failed"; readonly error: SessionError.Error }

/** Private conversation checkpoint workflow. */
export interface Interface {
  readonly required: (input: RequiredInput) => boolean
  readonly compact: (input: AutoInput) => Effect.Effect<Outcome>
  readonly compactManual: (input: ManualInput) => Effect.Effect<Outcome>
  readonly abort: (compaction: CompactionRunning) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/core/SessionCompaction") {}

const estimate = (value: string) => Math.round(value.length / 4)
const truncate = (value: string) => {
  if (value.length <= TOOL_OUTPUT_MAX_CHARS) return value
  return `${value.slice(0, TOOL_OUTPUT_MAX_CHARS)}\n[truncated]`
}
const toolContent = (content: readonly ToolContent[]) =>
  content
    .map((item) =>
      item.type === "text" ? item.text : `[Attached ${item.mime}${item.name === undefined ? "" : `: ${item.name}`}]`,
    )
    .join("\n")

export const serialize = (message: SessionMessage) => {
  if (message.type === "user") return `[User]: ${message.text}`
  if (message.type === "synthetic") return `[Synthetic context]: ${message.text}`
  if (message.type === "system") return `[System update]: ${message.text}`
  if (message.type !== "assistant") return ""
  return message.content
    .flatMap((part) => {
      if (part.type === "text") return [`[Assistant]: ${part.text}`]
      if (part.type === "reasoning") return part.text.length === 0 ? [] : [`[Assistant reasoning]: ${part.text}`]
      const input = typeof part.state.input === "string" ? part.state.input : JSON.stringify(part.state.input)
      if (part.state.status === "completed")
        return [
          `[Assistant tool call]: ${part.name}(${input})`,
          `[Tool result]: ${truncate(toolContent(part.state.content))}`,
        ]
      if (part.state.status === "error")
        return [`[Assistant tool call]: ${part.name}(${input})`, `[Tool error]: ${part.state.error.message}`]
      return [`[Assistant tool call]: ${part.name}(${input})`]
    })
    .join("\n")
}

export const buildPrompt = (input: { readonly previousSummary?: string; readonly context: readonly string[] }) =>
  [
    input.previousSummary === undefined
      ? "Create a new anchored checkpoint from the conversation history."
      : `Update this prior checkpoint, preserving still-true details and removing stale details:\n<previous-summary>\n${input.previousSummary}\n</previous-summary>`,
    SUMMARY_TEMPLATE,
    "Conversation history:",
    ...input.context,
  ].join("\n\n")

const plan = (messages: readonly SessionMessage[], keep: number) => {
  const conversation = messages.flatMap((message) => {
    const text = serialize(message)
    return text.length === 0 ? [] : [{ message, text }]
  })
  if (conversation.length === 0) return undefined
  let total = 0
  let split = conversation.length
  for (let index = conversation.length - 1; index >= 0; index--) {
    const item = conversation[index]
    if (item === undefined) continue
    const next = total + estimate(item.text)
    if (split < conversation.length && next > keep) break
    total = next
    split = index
  }
  while (split > 0 && conversation[split]?.message.type !== "user") split--
  if (split === 0) {
    const latestUser = conversation.findLastIndex((item) => item.message.type === "user")
    if (latestUser > 0) split = latestUser
  }
  const selected = {
    head: conversation
      .slice(0, split)
      .map((item) => item.text)
      .join("\n\n"),
    recent: conversation
      .slice(split)
      .map((item) => item.text)
      .join("\n\n"),
  }
  const previous = messages.findLast((message) => message.type === "compaction" && message.status === "completed")
  const previousRecent = previous?.recent ?? ""
  const summarizeRecent = previousRecent.length === 0 && selected.head.length === 0
  return {
    prompt: buildPrompt({
      ...(previous === undefined ? {} : { previousSummary: previous.summary }),
      context: summarizeRecent
        ? [selected.recent]
        : [previousRecent, selected.head].filter((value) => value.length > 0),
    }),
    recent: summarizeRecent ? "" : selected.recent,
  }
}

/** Construct compaction over one Workspace's durable Session authority. */
export const make = (
  database: Database.Interface,
  bus: Bus.Interface,
  workspaceID: Workspace.ID,
): Effect.Effect<
  Interface,
  never,
  Config.Service | Crypto.Crypto | Provider.Service | PluginHooks.Service | Permission.Service | ModelResolver.Service
> =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const crypto = yield* Crypto.Crypto
    const providers = yield* Provider.Service
    const hooks = yield* PluginHooks.Service
    const permission = yield* Permission.Service
    const resolver = yield* ModelResolver.Service
    const routing = yield* Effect.serviceOption(Routing.Service)
    const settings = (yield* config.get).compaction
    const failed = Effect.fn("SessionCompaction.failed")(function* (
      compaction: CompactionRunning,
      error: SessionError.Error,
      usage: Usage = empty,
    ) {
      const message = yield* database
        .transactRoot(
          Effect.gen(function* () {
            const sequence = yield* allocate(database, compaction.sessionID, 1)
            const next = CompactionFailed.make({
              id: compaction.id,
              sessionID: compaction.sessionID,
              sequence,
              type: "compaction",
              status: "failed",
              reason: compaction.reason,
              error,
              createdAt: compaction.createdAt,
            })
            yield* database.use("sessionCompactionFailure", (tx) =>
              tx
                .update(SessionMessageTable)
                .set({ sequence, data: next, timeUpdated: new Date() })
                .where(
                  and(
                    eq(SessionMessageTable.id, compaction.id),
                    eq(SessionMessageTable.sessionID, compaction.sessionID),
                  ),
                ),
            )
            return next
          }),
        )
        .pipe(Effect.orDie)
      yield* bus
        .publish(SessionEvent.CompactionFailed, { sessionID: compaction.sessionID, message, usage })
        .pipe(Effect.orDie)
      return { status: "failed" as const, error }
    })
    const execute = Effect.fn("SessionCompaction.execute")(function* (
      compaction: CompactionRunning,
      request: SessionModelRequest.Plan,
      prompt: string,
      recent: string,
    ) {
      const model = request.resolved.selection
      const providerContext = {
        purpose: request.purpose,
        sessionID: request.sessionID,
        messageID: request.messageID,
        agent: request.agent,
        requestedModel: request.requestedModel,
        model: request.model,
      }
      const http = yield* SessionHttp.middleware(providerContext).pipe(
        Effect.provideService(PluginHooks.Service, hooks),
      )
      const chunks: string[] = []
      let usage = empty
      const result = yield* providers
        .stream({
          context: providerContext,
          selection: model,
          runtimeModel: request.resolved.runtimeModel,
          authentication: request.resolved.authentication,
          http,
          messages: [Message.user(prompt)],
          tools: [],
          toolChoice: ToolChoice.make("none"),
        })
        .pipe(
          Stream.runForEach((event) => {
            if (event.type === "text-delta") {
              chunks.push(event.text)
              const current = CompactionRunning.make({ ...compaction, summary: chunks.join("") })
              return database
                .use("sessionCompactionDelta", (tx) =>
                  tx
                    .update(SessionMessageTable)
                    .set({ data: current, timeUpdated: new Date() })
                    .where(
                      and(
                        eq(SessionMessageTable.id, compaction.id),
                        eq(SessionMessageTable.sessionID, compaction.sessionID),
                      ),
                    ),
                )
                .pipe(
                  Effect.orDie,
                  Effect.andThen(
                    bus
                      .publish(SessionEvent.CompactionDelta, {
                        sessionID: compaction.sessionID,
                        messageID: compaction.id,
                        text: event.text,
                      })
                      .pipe(Effect.orDie),
                  ),
                  Effect.asVoid,
                )
            }
            if (event.type === "step-finish") usage = add(usage, normalize(event.usage, model.info.cost))
            return Effect.void
          }),
          Effect.result,
        )
      if (result._tag === "Failure") {
        yield* Effect.logWarning("Session compaction model request failed", {
          sessionID: compaction.sessionID,
          model: request.model,
          error: result.failure,
        })
        return yield* failed(
          compaction,
          result.failure._tag === "Provider.ContextOverflowError"
            ? SessionError.Provider.make({ message: "Compaction exceeded the model context window" })
            : providerSessionError(result.failure),
          usage,
        )
      }
      const summary = chunks.join("")
      if (summary.trim().length === 0)
        return yield* failed(
          compaction,
          SessionError.Internal.make({ message: "Compaction produced no summary" }),
          usage,
        )
      const message = yield* database
        .transactRoot(
          Effect.gen(function* () {
            const sequence = yield* allocate(database, compaction.sessionID, 1)
            const next = CompactionCompleted.make({
              id: compaction.id,
              sessionID: compaction.sessionID,
              sequence,
              type: "compaction",
              status: "completed",
              reason: compaction.reason,
              summary,
              recent,
              createdAt: compaction.createdAt,
            })
            yield* database.use("sessionCompactionComplete", (tx) =>
              tx
                .update(SessionMessageTable)
                .set({ sequence, data: next, timeUpdated: new Date() })
                .where(
                  and(
                    eq(SessionMessageTable.id, compaction.id),
                    eq(SessionMessageTable.sessionID, compaction.sessionID),
                  ),
                ),
            )
            yield* database.use("sessionCompactionAnchor", (tx) =>
              InstructionState.anchor(tx, compaction.sessionID, sequence),
            )
            return next
          }),
        )
        .pipe(Effect.orDie)
      yield* bus
        .publish(SessionEvent.CompactionEnded, { sessionID: compaction.sessionID, message, usage })
        .pipe(Effect.orDie)
      return { status: "completed" as const }
    })
    const compact = Effect.fn("SessionCompaction.compact")(function* (input: AutoInput) {
      const content = plan(input.messages, settings.keep.tokens)
      const id = yield* crypto.randomUUIDv4.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(CompactionRunning.fields.id)),
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.orDie,
      )
      const now = new Date()
      const compaction = yield* database
        .transactRoot(
          Effect.gen(function* () {
            const sequence = yield* allocate(database, input.sessionID, 1)
            const next = CompactionRunning.make({
              id,
              sessionID: input.sessionID,
              sequence,
              type: "compaction",
              status: "running",
              reason: "auto",
              summary: "",
              recent: content?.recent ?? "",
              createdAt: now,
            })
            yield* database.use("sessionCompactionStart", (tx) =>
              tx.insert(SessionMessageTable).values({
                id,
                sessionID: input.sessionID,
                sequence,
                type: next.type,
                data: next,
                timeCreated: now,
                timeUpdated: now,
              }),
            )
            return next
          }),
        )
        .pipe(Effect.orDie)
      yield* bus
        .publish(SessionEvent.CompactionStarted, { sessionID: input.sessionID, message: compaction })
        .pipe(Effect.orDie)
      if (content === undefined)
        return yield* failed(compaction, SessionError.Internal.make({ message: "Nothing to compact yet" }))
      return yield* Effect.gen(function* () {
        const request = yield* SessionModelRequest.plan({
          purpose: "compaction",
          sessionID: input.sessionID,
          projectID: input.projectID,
          messageID: compaction.id,
          agent: input.agent,
          requestedModel: input.requestedModel,
        }).pipe(
          SessionModelRequest.withRouting(routing),
          Effect.provideService(Provider.Service, providers),
          Effect.provideService(PluginHooks.Service, hooks),
          Effect.provideService(Permission.Service, permission),
          Effect.provideService(Bus.Service, bus),
          Effect.provideService(ModelResolver.Service, resolver),
          Effect.option,
        )
        if (Option.isNone(request))
          return yield* failed(compaction, SessionError.Provider.make({ message: "Compaction model routing failed" }))
        return yield* execute(compaction, request.value, content.prompt, content.recent)
      }).pipe(
        Effect.onInterrupt(() =>
          failed(compaction, SessionError.Aborted.make({ message: "Compaction interrupted" })).pipe(Effect.asVoid),
        ),
      )
    })
    const compactManual = Effect.fn("SessionCompaction.compactManual")(function* (input: ManualInput) {
      const content = plan(input.messages, settings.keep.tokens)
      if (content === undefined)
        return yield* failed(input.compaction, SessionError.Internal.make({ message: "Nothing to compact yet" }))
      const row = yield* database
        .use("sessionCompactionSelection", (db) =>
          db
            .select({ agent: SessionTable.agent, model: SessionTable.model, projectID: SessionTable.projectID })
            .from(SessionTable)
            .where(and(eq(SessionTable.workspaceID, workspaceID), eq(SessionTable.id, input.compaction.sessionID)))
            .limit(1)
            .pipe(Effect.map(Array.head)),
        )
        .pipe(Effect.orDie)
      if (Option.isNone(row))
        return yield* failed(input.compaction, SessionError.Internal.make({ message: "Compaction Session missing" }))
      const request = yield* SessionModelRequest.plan({
        purpose: "compaction",
        sessionID: input.compaction.sessionID,
        projectID: row.value.projectID,
        messageID: input.compaction.id,
        agent: row.value.agent,
        requestedModel: row.value.model,
      }).pipe(
        SessionModelRequest.withRouting(routing),
        Effect.provideService(Provider.Service, providers),
        Effect.provideService(PluginHooks.Service, hooks),
        Effect.provideService(Permission.Service, permission),
        Effect.provideService(Bus.Service, bus),
        Effect.provideService(ModelResolver.Service, resolver),
        Effect.option,
      )
      if (Option.isNone(request))
        return yield* failed(
          input.compaction,
          SessionError.Provider.make({ message: "Compaction model routing failed" }),
        )
      return yield* execute(input.compaction, request.value, content.prompt, content.recent)
    })
    const abort = Effect.fn("SessionCompaction.abort")(function* (compaction: CompactionRunning) {
      const row = yield* database
        .use("sessionCompactionAbortState", (db) =>
          db
            .select({ data: SessionMessageTable.data })
            .from(SessionMessageTable)
            .innerJoin(SessionTable, eq(SessionTable.id, SessionMessageTable.sessionID))
            .where(
              and(
                eq(SessionTable.workspaceID, workspaceID),
                eq(SessionMessageTable.id, compaction.id),
                eq(SessionMessageTable.sessionID, compaction.sessionID),
              ),
            )
            .limit(1)
            .pipe(Effect.map(Array.head)),
        )
        .pipe(Effect.orDie)
      if (Option.isNone(row)) return
      const current = yield* Schema.decodeUnknownEffect(Compaction)(row.value.data).pipe(Effect.orDie)
      if (current.status !== "running") return
      yield* failed(compaction, SessionError.Aborted.make({ message: "Compaction interrupted" }))
    })
    return Service.of({
      required: (input) => {
        if (!settings.auto || input.model.info.limit.context === undefined || input.model.info.limit.context <= 0)
          return false
        // An execution that failed before any Step finished records no usage; it says nothing
        // about the window, so measure the latest execution the provider actually observed.
        const latest = input.messages.findLast(
          (message) =>
            message.type === "assistant" &&
            message.time.completed !== undefined &&
            message.usage !== undefined &&
            context(message.usage) > 0,
        )
        const usage = latest?.type === "assistant" ? latest.usage : undefined
        if (usage === undefined) return false
        const limit = input.model.info.limit
        const ceiling = Math.min(
          limit.input === undefined ? Number.POSITIVE_INFINITY : limit.input - settings.buffer,
          input.model.info.limit.context -
            Math.max(Math.min(limit.output ?? OUTPUT_TOKEN_MAX, OUTPUT_TOKEN_MAX), settings.buffer),
        )
        return context(usage) >= ceiling
      },
      compact,
      compactManual,
      abort,
    })
  })
