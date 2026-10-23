import type { LLMEvent, ToolCall } from "@opencode-ai/ai/schema/events"
import type { Event } from "@bymorning/schema/event"
import { Assistant, type AssistantPart } from "@bymorning/schema/message"
import { SessionError } from "@bymorning/schema/session-error"
import { SessionEvent } from "@bymorning/schema/session-event"
import { empty } from "@bymorning/schema/usage"
import type { Cost } from "@bymorning/schema/model"
import { Tool } from "@bymorning/schema/tool"
import type { Workspace } from "@bymorning/schema/workspace"
import { and, eq, sql } from "drizzle-orm"
import { Array, DateTime, Duration, Effect, Latch, Option, Schema, Semaphore } from "effect"
import { SessionMessageTable, SessionTable, type Database } from "../database.js"
import type { Bus } from "../bus.js"
import { ToolOutput } from "../tool-output.js"
import { add, normalize } from "./usage.js"

type JsonObject = Readonly<{ [key: string]: Schema.Json }>

/** Provider output cannot be represented as a valid assistant contribution. */
export class ProviderError extends Schema.TaggedError<ProviderError>()("Session.Recorder.ProviderError", {
  message: Schema.String,
}) {}
/** Provider output parts arrived in an invalid order. */
export class OrderError extends Schema.TaggedError<OrderError>()("Session.Recorder.OrderError", {
  message: Schema.String,
}) {}

interface OpenPart {
  readonly index: number
  value: string
  open: boolean
}
/** Current in-memory state of one assistant recording. */
export interface Record {
  readonly calls: ReadonlyArray<ToolCall>
  readonly finish?: Assistant["finish"]
  readonly activeStep?: number
  readonly lastStep?: number
}
/** Persistence and failure controls for one assistant recording. */
export interface Interface {
  readonly write: (event: LLMEvent) => Effect.Effect<void, ProviderError | OrderError>
  readonly metadata: (id: string, metadata: Tool.Metadata) => Effect.Effect<void>
  readonly finishStream: Effect.Effect<void, ProviderError>
  readonly finishTools: Effect.Effect<void, ProviderError>
  readonly fail: (error: SessionError.Error, stepIndex?: number) => Effect.Effect<void>
  readonly failTool: (id: string, error: SessionError.Error) => Effect.Effect<boolean>
  /** Successfully settle a recorded, locally executed tool call. */
  readonly succeedTool: (id: string, result: Tool.Result) => Effect.Effect<void, OrderError>
  readonly state: () => Record
}

const object = (value: unknown) =>
  Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Json))(value).pipe(Effect.orDie)
const metadata = (value: unknown) =>
  value === undefined
    ? {}
    : { providerMetadata: Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(value) }
const providerExecution = (value: boolean | undefined) => (value === undefined ? {} : { providerExecuted: value })

/**
 * Longest time a provider delta stays only in memory before the Message row reflects it.
 *
 * Deltas are published on the Bus immediately; only their durable projection is coalesced.
 * A process crash between flushes therefore loses at most this much of an in-progress
 * contribution, which CONTEXT.md allows: saved Messages survive process failure, unsaved
 * Run output does not. Part boundaries, tool settlement, step and stream completion,
 * failure, and scope close flush immediately so nothing a client could observe as
 * settled is still pending.
 */
export const FlushWindow = Duration.millis(250)

/**
 * Construct a Recorder for one retained assistant contribution.
 *
 * The Recorder owns the Message `content` while it is open and keeps the canonical
 * in-progress Assistant in memory; the row is only a projection of it that trails by at
 * most `FlushWindow`. The requiring Scope bounds the recording: closing it writes any
 * pending content, which is how an interrupted Run keeps its last deltas.
 */
export const make = Effect.fn("Session.Recorder.make")(function* (input: {
  readonly database: Database.Interface
  readonly events: Bus.Interface
  readonly workspaceID: Workspace.ID
  readonly assistant: Assistant
  readonly cost?: Cost
}) {
  const output = yield* ToolOutput.Service
  const mutex = yield* Semaphore.make(1)
  /** Canonical in-progress contribution. Other writers own the remaining row fields. */
  let message = input.assistant
  /** `message.content` differs from the row. */
  let dirty = false
  /** The row no longer accepts partial output: it failed, completed, or disappeared. */
  let closed = false
  /** Opened by a coalesced change; the flusher waits on it so idle recordings cost nothing. */
  const pending = yield* Latch.make(false)
  const text = new Map<string, OpenPart>()
  const reasoning = new Map<string, OpenPart>()
  const toolInput = new Map<
    string,
    {
      readonly index: number
      readonly name: string
      readonly providerExecuted?: boolean
      readonly providerMetadata?: unknown
      raw: string
      ended: boolean
    }
  >()
  const calls = new Map<string, ToolCall>()
  const toolMetadata = new Map<string, JsonObject>()
  const settled = new Set<string>()
  let nextIndex = input.assistant.content.length
  let finish: Assistant["finish"]
  let streamFinished = false
  let activeStep: number | undefined
  let lastStep: number | undefined
  /** Save the replacement before making its corresponding live notification visible. */
  const transaction = <D extends import("@bymorning/schema/event").Event.Definition>(
    definition: D,
    data: Event.Data<D>,
    transform: (message: Assistant, now: Date) => Assistant,
  ) =>
    persistBoundary(transform).pipe(Effect.andThen(input.events.publish(definition, data)), Effect.orDie, Effect.asVoid)
  const rebuild = (
    message: Assistant,
    changes: Partial<Pick<Assistant, "content" | "usage" | "error" | "finish" | "time">>,
  ) =>
    Assistant.make({
      id: message.id,
      sessionID: message.sessionID,
      sequence: message.sequence,
      createdAt: message.createdAt,
      type: "assistant",
      agent: message.agent,
      model: message.model,
      ...(message.requestedModel === undefined ? {} : { requestedModel: message.requestedModel }),
      ...(message.route === undefined ? {} : { route: message.route }),
      content: changes.content ?? message.content,
      usage: changes.usage ?? message.usage,
      ...(changes.finish === undefined && message.finish === undefined
        ? {}
        : { finish: changes.finish ?? message.finish }),
      ...(changes.error === undefined && message.error === undefined ? {} : { error: changes.error ?? message.error }),
      time: changes.time ?? message.time,
      ...(message.retry === undefined ? {} : { retry: message.retry }),
    })
  const replace = (message: Assistant, index: number, part: AssistantPart) =>
    rebuild(message, { content: message.content.map((current, position) => (position === index ? part : current)) })
  const append = (message: Assistant, part: AssistantPart) => rebuild(message, { content: [...message.content, part] })
  const common = { sessionID: input.assistant.sessionID, messageID: input.assistant.id }
  /** Apply a change to the in-memory contribution without touching the row yet. */
  const change = (transform: (message: Assistant, now: Date) => Assistant) =>
    Effect.map(DateTime.nowAsDate, (now) => {
      const next = transform(message, now)
      if (next === message) return
      message = next
      dirty = true
    })
  /**
   * Project the in-memory `content` onto the row with one statement. Only `content` is
   * replaced so fields other writers own (retry, streamed, usage, completion) survive, and
   * a row that another writer already completed (interruption) is left alone.
   */
  const flush = Effect.gen(function* () {
    yield* pending.close
    if (!dirty || closed) return
    const now = yield* DateTime.nowAsDate
    const written = yield* input.database
      .use("sessionRecorderFlush", (tx) =>
        tx
          .update(SessionMessageTable)
          .set({
            data: sql`jsonb_set(${SessionMessageTable.data}, '{content}', ${JSON.stringify(message.content)}::jsonb)`,
            timeUpdated: now,
          })
          .where(
            and(
              eq(SessionMessageTable.id, input.assistant.id),
              eq(SessionMessageTable.sessionID, input.assistant.sessionID),
              sql`${SessionMessageTable.data} -> 'time' ->> 'completed' is null`,
            ),
          )
          .returning({ id: SessionMessageTable.id }),
      )
      .pipe(Effect.orDie)
    dirty = false
    if (written.length === 0) closed = true
  }).pipe(Effect.uninterruptible)
  /** Coalesce a provider delta: visible on the Bus now, durable within `FlushWindow`. */
  const persistDelta = (transform: (message: Assistant, now: Date) => Assistant) =>
    change(transform).pipe(Effect.andThen(pending.open))
  /** A part, step, or settlement boundary: the row must show it before its Event is visible. */
  const persistBoundary = (transform: (message: Assistant, now: Date) => Assistant) =>
    change(transform).pipe(Effect.andThen(flush))
  // Registered before the flusher so scope close interrupts the fiber first, then writes
  // whatever the interrupted recording still holds. `flush` avoids `transact`, which restores
  // interruptibility and would abandon the statement on an interrupted fiber.
  yield* Effect.addFinalizer(() => mutex.withPermits(1)(flush))
  yield* Effect.gen(function* () {
    while (true) {
      yield* pending.await
      yield* Effect.sleep(FlushWindow)
      yield* mutex.withPermits(1)(flush)
    }
  }).pipe(Effect.forkScoped)
  const persistUsage = (usage: Assistant["usage"]) =>
    input.database
      .transact(
        input.database.use("sessionRecorderUsage", (tx) =>
          Effect.gen(function* () {
            const row = yield* tx
              .select({ data: SessionMessageTable.data })
              .from(SessionMessageTable)
              .innerJoin(SessionTable, eq(SessionTable.id, SessionMessageTable.sessionID))
              .where(
                and(
                  eq(SessionMessageTable.id, input.assistant.id),
                  eq(SessionMessageTable.sessionID, input.assistant.sessionID),
                  eq(SessionTable.workspaceID, input.workspaceID),
                ),
              )
              .for("update")
              .pipe(Effect.map(Array.head))
            if (Option.isNone(row))
              return yield* Effect.die(new Error("Assistant Message missing while recording usage"))
            const current = yield* Schema.decodeUnknownEffect(Assistant)(row.value.data)
            const now = yield* DateTime.nowAsDate
            yield* tx
              .update(SessionMessageTable)
              .set({ data: rebuild(current, { usage: add(current.usage, usage) }), timeUpdated: now })
              .where(eq(SessionMessageTable.id, input.assistant.id))
            yield* tx
              .update(SessionTable)
              .set({
                usage_cost: sql`least(${SessionTable.usage_cost} + ${usage.cost.toString()}::numeric, 999999999999999::numeric)`,
                usageCostComplete: sql`${SessionTable.usageCostComplete} and ${usage.costComplete}`,
                usageTotal:
                  usage.tokens.total === undefined
                    ? SessionTable.usageTotal
                    : sql`least(coalesce(${SessionTable.usageTotal}, 0) + ${usage.tokens.total}, ${Number.MAX_SAFE_INTEGER})`,
                usageInput: sql`least(${SessionTable.usageInput} + ${usage.tokens.input}, ${Number.MAX_SAFE_INTEGER})`,
                usageOutput: sql`least(${SessionTable.usageOutput} + ${usage.tokens.output}, ${Number.MAX_SAFE_INTEGER})`,
                usageReasoning: sql`least(${SessionTable.usageReasoning} + ${usage.tokens.reasoning}, ${Number.MAX_SAFE_INTEGER})`,
                usageCacheRead: sql`least(${SessionTable.usageCacheRead} + ${usage.tokens.cache.read}, ${Number.MAX_SAFE_INTEGER})`,
                usageCacheWrite: sql`least(${SessionTable.usageCacheWrite} + ${usage.tokens.cache.write}, ${Number.MAX_SAFE_INTEGER})`,
                timeUpdated: now,
              })
              .where(
                and(eq(SessionTable.id, input.assistant.sessionID), eq(SessionTable.workspaceID, input.workspaceID)),
              )
          }),
        ),
      )
      .pipe(Effect.orDie)
  const failOrder = (message: string) => Effect.fail(new OrderError({ message }))
  const write = (event: LLMEvent) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        switch (event.type) {
          case "step-start":
            if (activeStep !== undefined) return yield* failOrder(`step start before step finish: ${event.index}`)
            activeStep = event.index
            return yield* transaction(SessionEvent.StepStarted, { ...common, index: event.index }, (message) => message)
          case "step-finish":
            if (activeStep === undefined) return yield* failOrder(`step finish without start: ${event.index}`)
            if (activeStep !== event.index)
              return yield* failOrder(`step finish index ${event.index} does not match start ${activeStep}`)
            finish = event.reason.normalized
            // Match OpenCode's processor ordering: apply the terminal reason
            // before publishing the Step terminal. Provider failure reasons
            // leave the Step open so fail can atomically publish the
            // sole Step terminal (StepFailed) with ExecutionFailed.
            if (finish === "error" || finish === "content-filter") return yield* Effect.void
            const terminalFinish = finish
            lastStep = event.index
            activeStep = undefined
            {
              const usage = input.cost === undefined ? empty : normalize(event.usage, input.cost)
              yield* flush
              yield* persistUsage(usage)
              return yield* input.events
                .publish(SessionEvent.StepEnded, { ...common, index: event.index, finish: terminalFinish, usage })
                .pipe(Effect.orDie, Effect.asVoid)
            }
          case "text-start": {
            if (text.has(event.id)) return yield* failOrder(`duplicate text start: ${event.id}`)
            const index = nextIndex++
            text.set(event.id, { index, value: "", open: true })
            return yield* transaction(
              SessionEvent.TextStarted,
              { ...common, partID: event.id, ordinal: index },
              (message) => append(message, { type: "text", id: event.id, text: "" }),
            )
          }
          case "text-delta":
            {
              const part = text.get(event.id)
              if (!part?.open) return yield* failOrder(`text delta without start: ${event.id}`)
              part.value += event.text
              yield* persistDelta((message) =>
                replace(message, part.index, { type: "text", id: event.id, text: part.value }),
              )
              yield* input.events
                .publish(SessionEvent.TextDelta, { ...common, partID: event.id, text: event.text })
                .pipe(Effect.orDie)
              return yield* Effect.void
            }
            return yield* Effect.void
          case "text-end": {
            const part = text.get(event.id)
            if (!part?.open) return yield* failOrder(`text end without start: ${event.id}`)
            part.value = event.text ?? part.value
            part.open = false
            return yield* transaction(
              SessionEvent.TextEnded,
              { ...common, partID: event.id, text: part.value, ...metadata(event.providerMetadata) },
              (message) =>
                replace(message, part.index, {
                  type: "text",
                  id: event.id,
                  text: part.value,
                  ...metadata(event.providerMetadata),
                }),
            )
          }
          case "reasoning-start": {
            if (reasoning.has(event.id)) return yield* failOrder(`duplicate reasoning start: ${event.id}`)
            const index = nextIndex++
            reasoning.set(event.id, { index, value: "", open: true })
            return yield* transaction(
              SessionEvent.ReasonStarted,
              { ...common, partID: event.id, ordinal: index },
              (message) => append(message, { type: "reasoning", id: event.id, text: "" }),
            )
          }
          case "reasoning-delta": {
            const part = reasoning.get(event.id)
            if (!part?.open) return yield* failOrder(`reasoning delta without start: ${event.id}`)
            part.value += event.text
            yield* persistDelta((message) =>
              replace(message, part.index, { type: "reasoning", id: event.id, text: part.value }),
            )
            yield* input.events
              .publish(SessionEvent.ReasonDelta, { ...common, partID: event.id, text: event.text })
              .pipe(Effect.orDie)
            return yield* Effect.void
          }
          case "reasoning-end": {
            const part = reasoning.get(event.id)
            if (!part?.open) return yield* failOrder(`reasoning end without start: ${event.id}`)
            part.value = event.text ?? part.value
            part.open = false
            return yield* transaction(
              SessionEvent.ReasonEnded,
              { ...common, partID: event.id, text: part.value, ...metadata(event.providerMetadata) },
              (message) =>
                replace(message, part.index, {
                  type: "reasoning",
                  id: event.id,
                  text: part.value,
                  ...metadata(event.providerMetadata),
                }),
            )
          }
          case "tool-input-start": {
            if (toolInput.has(event.id) || calls.has(event.id))
              return yield* failOrder(`duplicate tool input start: ${event.id}`)
            const index = nextIndex++
            toolInput.set(event.id, {
              index,
              name: event.name,
              providerExecuted: event.providerExecuted,
              providerMetadata: event.providerMetadata,
              raw: "",
              ended: false,
            })
            return yield* transaction(
              SessionEvent.InputStarted,
              {
                ...common,
                callID: event.id,
                ordinal: index,
                name: event.name,
                ...providerExecution(event.providerExecuted),
                ...metadata(event.providerMetadata),
              },
              (message, now) =>
                append(message, {
                  type: "tool",
                  id: event.id,
                  name: event.name,
                  state: { status: "streaming", input: "" },
                  time: { created: now },
                  ...metadata(event.providerMetadata),
                }),
            )
          }
          case "tool-input-delta": {
            const part = toolInput.get(event.id)
            if (part === undefined || part.ended) return yield* failOrder(`tool input delta without start: ${event.id}`)
            part.raw += event.text
            yield* persistDelta((message) => {
              const current = message.content[part.index]
              if (current?.type !== "tool") return message
              return replace(message, part.index, { ...current, state: { status: "streaming", input: part.raw } })
            })
            yield* input.events
              .publish(SessionEvent.InputDelta, { ...common, callID: event.id, text: event.text })
              .pipe(Effect.orDie)
            return yield* Effect.void
          }
          case "tool-input-end": {
            const part = toolInput.get(event.id)
            if (part === undefined || part.ended) return yield* failOrder(`tool input end without start: ${event.id}`)
            if (part.name !== event.name) return yield* failOrder(`tool input name changed: ${event.id}`)
            part.ended = true
            return yield* transaction(
              SessionEvent.InputEnded,
              { ...common, callID: event.id, name: event.name, input: part.raw, ...metadata(event.providerMetadata) },
              (message) => message,
            )
          }
          case "tool-input-error": {
            const part = toolInput.get(event.id)
            if (part === undefined || part.ended) return yield* failOrder(`tool input error without start: ${event.id}`)
            if (part.name !== event.name) return yield* failOrder(`tool input name changed: ${event.id}`)
            const error = SessionError.Tool.make({ message: "Tool arguments were not valid JSON" })
            toolInput.delete(event.id)
            return yield* transaction(
              SessionEvent.ToolFailed,
              {
                ...common,
                callID: event.id,
                name: event.name,
                input: {},
                error,
                ...providerExecution(part.providerExecuted),
                ...metadata(part.providerMetadata),
              },
              (message, now) => {
                const current = toolPart(message.content[part.index], event.id)
                return replace(message, part.index, {
                  ...current,
                  state: { status: "error", input: {}, error },
                  time: { ...current.time, completed: now },
                })
              },
            )
          }
          case "tool-call": {
            if (calls.has(event.id)) return yield* failOrder(`duplicate tool call: ${event.id}`)
            const parsed = yield* object(event.input)
            const open = toolInput.get(event.id)
            if (open !== undefined && !open.ended) return yield* failOrder(`tool call before input end: ${event.id}`)
            if (open !== undefined && open.name !== event.name)
              return yield* failOrder(`tool input name changed: ${event.id}`)
            const call = {
              ...event,
              providerExecuted: event.providerExecuted ?? open?.providerExecuted,
            } satisfies ToolCall
            calls.set(event.id, call)
            toolInput.delete(event.id)
            const index = open?.index ?? nextIndex++
            return yield* transaction(
              SessionEvent.ToolCalled,
              {
                ...common,
                callID: event.id,
                name: event.name,
                input: parsed,
                ...providerExecution(call.providerExecuted),
                ...metadata(event.providerMetadata),
              },
              (message, now) => {
                const part = {
                  type: "tool",
                  id: event.id,
                  name: event.name,
                  state: { status: "running", input: parsed },
                  time: { created: now, ran: now },
                  ...providerExecution(call.providerExecuted),
                  ...metadata(event.providerMetadata),
                } satisfies AssistantPart
                return open === undefined ? append(message, part) : replace(message, index, part)
              },
            )
          }
          case "tool-result": {
            const call = calls.get(event.id)
            if (call === undefined) return yield* failOrder(`tool result without call: ${event.id}`)
            if (settled.has(event.id)) return yield* Effect.void
            if (call.name !== event.name) return yield* failOrder(`tool result name changed: ${event.id}`)
            calls.set(event.id, {
              ...call,
              ...(event.providerExecuted === true ? { providerExecuted: true } : {}),
              ...(event.providerMetadata === undefined ? {} : { providerMetadata: event.providerMetadata }),
            })
            if (event.result.type === "error")
              return yield* failToolUnlocked(
                event.id,
                SessionError.Tool.make({ message: String(event.result.value) }),
              ).pipe(Effect.asVoid)
            const content = Array.isArray(event.output?.content)
              ? event.output.content
              : event.result.type === "content" && Array.isArray(event.result.value)
                ? event.result.value
                : [{ type: "text" as const, text: JSON.stringify(event.result.value) }]
            return yield* settleSuccessUnlocked(
              event.id,
              {
                content,
                ...(event.output?.structured === undefined ? {} : { output: event.output.structured }),
                ...(toolMetadata.get(event.id) === undefined ? {} : { metadata: toolMetadata.get(event.id) }),
              },
              "provider",
            )
          }
          case "tool-error": {
            const call = calls.get(event.id)
            if (call === undefined) return yield* failOrder(`tool error without call: ${event.id}`)
            if (settled.has(event.id)) return yield* Effect.void
            if (call.name !== event.name) return yield* failOrder(`tool error name changed: ${event.id}`)
            yield* failToolUnlocked(event.id, SessionError.Tool.make({ message: event.message }))
            return yield* Effect.void
          }
          case "provider-error":
            return yield* new ProviderError({ message: event.message })
          case "finish":
            finish = event.reason.normalized
            streamFinished = true
            return yield* Effect.void
        }
        return yield* Effect.void
      }),
    )
  const toolPart = (part: AssistantPart | undefined, id: string): Extract<AssistantPart, { type: "tool" }> => {
    if (part?.type !== "tool") throw new Error(`Tool part missing: ${id}`)
    return part
  }
  const settleSuccessUnlocked = (id: string, result: Tool.Result, execution: "local" | "provider") =>
    Effect.gen(function* () {
      const call = calls.get(id)
      if (call === undefined) return yield* failOrder(`tool success without call: ${id}`)
      if (settled.has(id)) return yield* Effect.void
      if (execution === "local" && call.providerExecuted === true)
        return yield* failOrder(`local success for provider-hosted tool call: ${id}`)
      if (execution === "provider" && call.providerExecuted !== true)
        return yield* failOrder(`provider success for locally executed tool call: ${id}`)
      const parsedInput = yield* object(call.input)
      const resultMetadata =
        toolMetadata.get(id) === undefined && result.metadata === undefined
          ? undefined
          : { ...toolMetadata.get(id), ...(result.metadata === undefined ? {} : yield* object(result.metadata)) }
      const parsedResult = {
        ...(result.content === undefined ? {} : { content: result.content }),
        ...(result.output === undefined
          ? {}
          : { output: yield* Schema.decodeUnknownEffect(Schema.Json)(result.output).pipe(Effect.orDie) }),
        ...(resultMetadata === undefined ? {} : { metadata: resultMetadata }),
      } satisfies Tool.Result
      const bounded = yield* output.truncate(input.assistant.sessionID, parsedResult)
      const content =
        typeof bounded.content === "string"
          ? [{ type: "text" as const, text: bounded.content }]
          : (bounded.content ?? [])
      const boundedMetadata = bounded.metadata === undefined ? undefined : yield* object(bounded.metadata)
      yield* transaction(
        SessionEvent.ToolSuccess,
        {
          ...common,
          callID: id,
          name: call.name,
          input: parsedInput,
          content,
          ...(bounded.output === undefined
            ? {}
            : { result: yield* Schema.decodeUnknownEffect(Schema.Json)(bounded.output).pipe(Effect.orDie) }),
          ...(boundedMetadata === undefined ? {} : { metadata: boundedMetadata }),
          ...providerExecution(call.providerExecuted),
          ...metadata(call.providerMetadata),
        },
        (message, now) => {
          const index = message.content.findIndex((part) => part.type === "tool" && part.id === id)
          if (index < 0) return message
          const current = toolPart(message.content[index], id)
          return replace(message, index, {
            ...current,
            state: {
              status: "completed",
              input: parsedInput,
              content,
              ...(bounded.output === undefined ? {} : { result: bounded.output }),
              ...(boundedMetadata === undefined ? {} : { metadata: boundedMetadata }),
            },
            time: { ...current.time, completed: now },
            ...providerExecution(call.providerExecuted),
            ...metadata(call.providerMetadata),
          })
        },
      )
      settled.add(id)
    })
  const succeedTool = (id: string, result: Tool.Result) =>
    mutex.withPermits(1)(settleSuccessUnlocked(id, result, "local"))
  const failToolUnlocked = (id: string, error: SessionError.Error) =>
    Effect.gen(function* () {
      const call = calls.get(id)
      if (call === undefined || settled.has(id)) return false
      const parsed = yield* object(call.input)
      yield* transaction(
        SessionEvent.ToolFailed,
        {
          ...common,
          callID: id,
          name: call.name,
          input: parsed,
          error,
          ...(toolMetadata.get(id) === undefined ? {} : { metadata: toolMetadata.get(id) }),
          ...providerExecution(call.providerExecuted),
          ...metadata(call.providerMetadata),
        },
        (message, now) => {
          const index = message.content.findIndex((part) => part.type === "tool" && part.id === id)
          if (index < 0) return message
          const current = toolPart(message.content[index], id)
          return replace(message, index, {
            ...current,
            state: {
              status: "error",
              input: parsed,
              error,
              ...(toolMetadata.get(id) === undefined ? {} : { metadata: toolMetadata.get(id) }),
            },
            time: { ...current.time, completed: now },
          })
        },
      )
      settled.add(id)
      return true
    })
  const failTool = (id: string, error: SessionError.Error) => mutex.withPermits(1)(failToolUnlocked(id, error))
  const fail = (error: SessionError.Error, stepIndex?: number) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const unsettled = yield* Effect.forEach(
          [...calls.values()].filter((call) => !settled.has(call.id)),
          (call) => object(call.input).pipe(Effect.map((parsed) => ({ call, parsed }))),
        )
        // A failed assistant and every unsettled tool are one durable settlement.
        // Do not let a live Event projector be responsible for making this readable.
        // The in-memory content includes deltas the row has not received yet.
        const content = message.content
        const completed = yield* input.database
          .transact(
            input.database.use("sessionRecorderFail", (tx) =>
              Effect.gen(function* () {
                const row = yield* tx
                  .select({ data: SessionMessageTable.data })
                  .from(SessionMessageTable)
                  .innerJoin(SessionTable, eq(SessionTable.id, SessionMessageTable.sessionID))
                  .where(
                    and(
                      eq(SessionMessageTable.id, input.assistant.id),
                      eq(SessionMessageTable.sessionID, input.assistant.sessionID),
                      eq(SessionTable.workspaceID, input.workspaceID),
                    ),
                  )
                  .for("update")
                  .pipe(Effect.map(Array.head))
                if (Option.isNone(row)) return yield* Effect.die(new Error("Assistant Message missing while failing"))
                const current = yield* Schema.decodeUnknownEffect(Assistant)(row.value.data)
                const now = yield* DateTime.nowAsDate
                const message = rebuild(current, {
                  error,
                  content: content.map((part) => {
                    if (part.type !== "tool" || (part.state.status !== "streaming" && part.state.status !== "running"))
                      return part
                    return {
                      ...part,
                      state: {
                        status: "error" as const,
                        input: part.state.status === "running" ? part.state.input : {},
                        error,
                      },
                      time: { ...part.time, completed: now },
                    }
                  }),
                  ...(finish === undefined ? {} : { finish }),
                  time: { ...current.time, completed: now },
                })
                yield* tx
                  .update(SessionMessageTable)
                  .set({ data: message, timeUpdated: now })
                  .where(eq(SessionMessageTable.id, input.assistant.id))
                yield* tx
                  .update(SessionTable)
                  .set({ timeUpdated: now })
                  .where(
                    and(
                      eq(SessionTable.id, input.assistant.sessionID),
                      eq(SessionTable.workspaceID, input.workspaceID),
                    ),
                  )
                return message
              }),
            ),
          )
          .pipe(Effect.orDie)
        // The failure is the terminal content write; later flushes must not revive the row.
        message = completed
        dirty = false
        closed = true
        yield* pending.close
        for (const { call, parsed } of unsettled) {
          yield* input.events
            .publish(SessionEvent.ToolFailed, {
              ...common,
              callID: call.id,
              name: call.name,
              input: parsed,
              error,
              ...(toolMetadata.get(call.id) === undefined ? {} : { metadata: toolMetadata.get(call.id) }),
              ...providerExecution(call.providerExecuted),
              ...metadata(call.providerMetadata),
            })
            .pipe(Effect.orDie)
        }
        if (stepIndex !== undefined)
          yield* input.events
            .publish(SessionEvent.StepFailed, { ...common, index: stepIndex, error })
            .pipe(Effect.orDie)
        yield* input.events
          .publish(SessionEvent.Failed, {
            sessionID: input.assistant.sessionID,
            message: completed,
            error,
            ...(finish === undefined ? {} : { finish }),
          })
          .pipe(Effect.orDie)
        yield* Effect.sync(() => unsettled.forEach(({ call }) => settled.add(call.id)))
      }),
    )
  const incomplete = (message: string) => Effect.fail(new ProviderError({ message }))
  const validateStructure = Effect.gen(function* () {
    const openText = [...text].find(([, part]) => part.open)
    if (openText !== undefined) {
      const [id] = openText
      return yield* incomplete(`Provider stream ended before text end: ${id}`)
    }
    const openReasoning = [...reasoning].find(([, part]) => part.open)
    if (openReasoning !== undefined) {
      const [id] = openReasoning
      return yield* incomplete(`Provider stream ended before reasoning end: ${id}`)
    }
    const openInput = toolInput.keys().next().value
    if (openInput !== undefined) return yield* incomplete(`Provider stream ended before tool call: ${openInput}`)
    if (activeStep !== undefined && finish !== "error" && finish !== "content-filter")
      return yield* incomplete(`Provider stream ended before step finish: ${activeStep}`)
    if (!streamFinished) return yield* incomplete("Provider stream ended without finish")
    return yield* Effect.void
  })
  const finishStream = mutex.withPermits(1)(
    Effect.gen(function* () {
      yield* flush
      yield* validateStructure
      const hosted = [...calls.values()].find((call) => call.providerExecuted === true && !settled.has(call.id))
      if (hosted !== undefined)
        return yield* incomplete(`Provider stream ended before hosted tool result: ${hosted.id}`)
      return yield* Effect.void
    }),
  )
  const finishTools = mutex.withPermits(1)(
    Effect.gen(function* () {
      yield* flush
      yield* validateStructure
      const running = [...calls.values()].find((call) => !settled.has(call.id))
      if (running !== undefined) return yield* incomplete(`Tool call did not settle: ${running.id}`)
      return yield* Effect.void
    }),
  )
  const recordMetadata = (id: string, value: Tool.Metadata) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const decoded = yield* object(value)
        const call = calls.get(id)
        if (call === undefined || settled.has(id)) return
        const accumulated = { ...toolMetadata.get(id), ...decoded }
        toolMetadata.set(id, accumulated)
        // Tool progress has no live Event; reconnecting clients only see it from the row.
        yield* persistBoundary((message) => {
          const index = message.content.findIndex((part) => part.type === "tool" && part.id === id)
          if (index < 0) return message
          const current = toolPart(message.content[index], id)
          if (current.state.status !== "running") return message
          return replace(message, index, { ...current, state: { ...current.state, metadata: accumulated } })
        })
      }),
    )
  return {
    write,
    metadata: recordMetadata,
    finishStream,
    finishTools,
    fail,
    failTool,
    succeedTool,
    state: () => ({
      calls: [...calls.values()],
      ...(finish === undefined ? {} : { finish }),
      ...(activeStep === undefined ? {} : { activeStep }),
      ...(lastStep === undefined ? {} : { lastStep }),
    }),
  } satisfies Interface
})
export * as SessionRecorder from "./recorder.js"
