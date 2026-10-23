import { Option, Schema } from "effect"

import type {
  SessionPolicyNotice,
  SessionTranscript,
  TranscriptEntry,
  TranscriptMessage,
} from "../../context/session-state"
import type { ModelOption } from "../../utils/model-option"
import type { SessionUI } from "./ui/session-model"
import { projectTimeline } from "./timeline/projection"

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

interface PrivateInput {
  readonly transcript: SessionTranscript
  readonly policyNotices?: ReadonlyArray<SessionPolicyNotice>
  readonly models: ReadonlyArray<Pick<ModelOption, "id" | "name" | "provider">>
  readonly preferences?: SessionUI.Preferences
  readonly previousRows?: ReadonlyArray<SessionUI.TimelineRow>
  readonly entry?: (messageID: string) => TranscriptEntry | undefined
  readonly cache?: Map<
    string,
    { readonly revision: number; readonly models: PrivateInput["models"]; readonly value: SessionUI.AssistantMessage }
  >
}

export function createTimelineParser() {
  const cache = new Map<
    string,
    { readonly revision: number; readonly models: PrivateInput["models"]; readonly value: SessionUI.AssistantMessage }
  >()
  return (input: Omit<PrivateInput, "cache">) => {
    if (input.transcript.state === "ready") {
      const retained = new Set<string>((input.transcript.data ?? []).map((entry) => entry.message.id))
      cache.forEach((_value, messageID) => {
        if (!retained.has(messageID)) cache.delete(messageID)
      })
    }
    if (input.transcript.state !== "ready") cache.clear()
    return parseTimeline({ ...input, cache })
  }
}

export function parseTimeline(input: PrivateInput): SessionUI.Timeline {
  if (input.transcript.state === "error") return { state: "failed", message: input.transcript.message }
  if (input.transcript.state !== "ready") return { state: "loading" }

  const items = groupTranscriptItems(input.transcript.data ?? [], input.policyNotices ?? [], input.models, input.cache)
  const projection = projectTimeline(
    items,
    input.preferences ?? { showAgent: true, showReasoning: true, showUsage: true },
    input.previousRows,
  )
  const live = new Map<string, { readonly revision: number; readonly assistant: SessionUI.AssistantMessage }>()

  return {
    state: "ready",
    items,
    ...projection,
    resolvePart: (messageID: string, partID: string) => {
      const fallback = projection.partByKey.get(`${messageID}:${partID}`)
      const entry = input.entry?.(messageID)
      if (entry?.message.type !== "assistant") {
        live.delete(messageID)
        return fallback
      }
      const cached = live.get(messageID)
      const assistant = cached?.revision === entry.revision ? cached.assistant : presentAssistant(entry, input.models)
      if (cached?.revision !== entry.revision) live.set(messageID, { revision: entry.revision, assistant })
      const part = assistant.parts.find((candidate) => candidate.id === partID)
      return part === undefined
        ? fallback
        : { ...fallback, messageID, part, streaming: assistant.streaming && !assistant.cancelling }
    },
  }
}

function presentPolicyNotice(notice: SessionPolicyNotice): SessionUI.Notice {
  const message = notice.message?.trim()
  const tools = notice.resource.split("::").map(formatResource)
  const effect = notice.effect === "deny" ? "denied" : notice.effect === "transform" ? "transformed" : "routed"
  const title =
    notice.action === "tool.combine"
      ? `Tool combination ${effect} by policy`
      : notice.action === "model.tool"
        ? `Model tool ${effect} by policy`
        : notice.action === "tool.execute"
          ? `Tool ${effect} by policy`
          : notice.action === "model.request" || notice.action === "model.use"
            ? `Model request ${effect} by policy`
            : notice.action === "provider.request" || notice.action === "provider.use"
              ? `Provider request ${effect} by policy`
              : notice.effect === "route"
                ? "Request routed by policy"
                : notice.effect === "transform"
                  ? "Request transformed by policy"
                  : "Request denied by policy"
  return {
    type: "notice",
    id: notice.id,
    kind: "policy",
    effect: notice.effect,
    ...(notice.messageID === undefined ? {} : { messageID: notice.messageID }),
    ...(notice.callID === undefined ? {} : { callID: notice.callID }),
    action: notice.action,
    resource: notice.resource,
    policy: notice.policy,
    rule: notice.rule,
    created: notice.created,
    text: title,
    detail:
      message ||
      (notice.action === "tool.combine" && tools.length >= 2
        ? `${tools[0]} and ${tools[1]} cannot be combined in this session.`
        : notice.action === "model.tool" && tools.length >= 2
          ? `${tools[1]} cannot be used with ${tools[0]} in this session.`
          : notice.action === "tool.execute" && notice.effect === "deny"
            ? `${formatResource(notice.resource)} cannot be used in this session.`
            : (notice.action === "model.request" || notice.action === "model.use") && notice.effect === "deny"
              ? `${formatResource(notice.resource)} cannot handle this request in this session.`
              : (notice.action === "provider.request" || notice.action === "provider.use") && notice.effect === "deny"
                ? `${formatResource(notice.resource)} cannot provide this request in this session.`
                : notice.effect === "route"
                  ? "A policy selected a different route for this request."
                  : notice.effect === "transform"
                    ? "A policy transformed this request."
                    : "A Workspace policy prevented this request."),
  }
}

function formatResource(value: string) {
  const label = value.split("/").at(-1) ?? value
  return label.replace(/[_-]+/g, " ").replace(/^\w/, (character) => character.toUpperCase())
}

function groupTranscriptItems(
  entries: ReadonlyArray<TranscriptEntry>,
  policyNotices: ReadonlyArray<SessionPolicyNotice>,
  models: ReadonlyArray<Pick<ModelOption, "id" | "name" | "provider">>,
  cache?: PrivateInput["cache"],
) {
  const messageIDs = new Set(entries.map((entry) => entry.message.id))
  const toolOwners = new Map(
    entries.flatMap((entry) =>
      entry.message.type === "assistant"
        ? (entry.message.content ?? []).flatMap((part) =>
            part.type === "tool" ? [[part.id, entry.message.id] as const] : [],
          )
        : [],
    ),
  )
  const orderedNotices = policyNotices.toSorted(
    (left, right) => left.created.localeCompare(right.created) || left.id.localeCompare(right.id),
  )
  const owner = (notice: SessionPolicyNotice) =>
    notice.messageID !== undefined && messageIDs.has(notice.messageID)
      ? notice.messageID
      : notice.callID === undefined
        ? undefined
        : toolOwners.get(notice.callID)
  const noticesByMessage = Map.groupBy(orderedNotices, owner)
  const items: Array<SessionUI.Item> = (noticesByMessage.get(undefined) ?? []).map(presentPolicyNotice)

  for (const entry of entries) {
    const message = entry.message
    if (message.type === "pending-user") {
      const state: SessionUI.TurnState =
        entry.activity?.state === "queued"
          ? { type: "queued" }
          : entry.activity?.state === "failed"
            ? { type: "failed", failure: { type: "generic", message: entry.activity.message } }
            : entry.activity?.state === "cancelled"
              ? { type: "interrupted" }
              : { type: "working" }
      items.push({
        type: "turn",
        id: message.id,
        user: { id: message.id, text: message.text, agents: message.agents, createdAt: message.createdAt.getTime() },
        assistant: [],
        state,
      })
      items.push(...(noticesByMessage.get(message.id) ?? []).map(presentPolicyNotice))
      continue
    }
    if (message.type === "pending-compaction") {
      items.push({
        type: "notice",
        id: message.id,
        kind: "compaction",
        status: entry.activity?.state === "failed" ? "failed" : "queued",
        reason: "manual",
        text: entry.activity?.state === "failed" ? "Compaction failed" : "Compaction queued",
        detail: entry.activity?.state === "failed" ? entry.activity.message : "Waiting for current work to finish.",
      })
      continue
    }
    if (message.type === "synthetic") {
      if (message.description?.trim()) {
        items.push({ type: "notice", id: message.id, kind: "system", text: message.description.trim() })
      }
      items.push(...(noticesByMessage.get(message.id) ?? []).map(presentPolicyNotice))
      continue
    }
    if (message.type === "user") {
      items.push({
        type: "turn",
        id: message.id,
        user: {
          id: message.id,
          text: message.text,
          ...(message.agents === undefined ? {} : { agents: message.agents }),
          createdAt: message.createdAt.getTime(),
        },
        assistant: [],
        state: { type: "complete" },
      })
      items.push(...(noticesByMessage.get(message.id) ?? []).map(presentPolicyNotice))
      continue
    }
    if (message.type === "system") {
      // Durable instruction updates belong to model context, not the conversation UI.
      items.push(...(noticesByMessage.get(message.id) ?? []).map(presentPolicyNotice))
      continue
    }
    if (message.type === "agent-switched" || message.type === "model-switched") {
      items.push({
        type: "notice",
        id: message.id,
        kind: "selection",
        text:
          message.type === "agent-switched"
            ? `Agent switched to ${message.agent}`
            : `Model switched to ${listedName(message.model, models) ?? message.model.id}${message.model.variant ? ` · ${message.model.variant}` : ""}`,
      })
      items.push(...(noticesByMessage.get(message.id) ?? []).map(presentPolicyNotice))
      continue
    }
    if (message.type === "compaction") {
      items.push({
        type: "notice",
        id: message.id,
        kind: "compaction",
        status: message.status,
        reason: message.reason,
        text:
          message.status === "running"
            ? "Compacting session"
            : message.status === "failed"
              ? "Compaction failed"
              : "Session compacted",
        detail:
          message.status === "running"
            ? "Creating a shorter context checkpoint."
            : message.status === "failed"
              ? parseError(message.error.message)
              : "Future messages will use this checkpoint.",
        ...(message.status === "completed" ? { summary: message.summary, recent: message.recent } : {}),
      })
      items.push(...(noticesByMessage.get(message.id) ?? []).map(presentPolicyNotice))
      continue
    }
    if (message.type !== "assistant") message satisfies never

    const cached = cache?.get(message.id)
    const assistant =
      cached?.revision === entry.revision && cached.models === models ? cached.value : presentAssistant(entry, models)
    cache?.set(message.id, { revision: entry.revision, models, value: assistant })
    attachAssistant(items, assistant)
    items.push(...(noticesByMessage.get(message.id) ?? []).map(presentPolicyNotice))
  }

  return items
}

/** The picker's display name for a listed Model. */
function listedName(
  model: { readonly id: string; readonly provider: string },
  models: ReadonlyArray<Pick<ModelOption, "id" | "name" | "provider">>,
) {
  return models.find((item) => item.provider === model.provider && item.id === model.id)?.name
}

function presentAssistant(
  entry: TranscriptEntry,
  models: ReadonlyArray<Pick<ModelOption, "id" | "name" | "provider">>,
): SessionUI.AssistantMessage {
  if (entry.message.type !== "assistant") throw new Error("Assistant expected")
  const message = entry.message
  const agent = message.agent
  const friendlyModel = message.model ? listedName(message.model, models) : undefined
  const model = message.model ? (friendlyModel ?? message.model.id) : undefined
  const details: SessionUI.MessageDetails | undefined =
    model === undefined
      ? undefined
      : {
          ...(agent === undefined ? {} : { agent }),
          model,
          ...(message.usage === undefined
            ? {}
            : {
                usage: {
                  tokens:
                    message.usage.tokens.total ??
                    message.usage.tokens.input +
                      message.usage.tokens.output +
                      message.usage.tokens.reasoning +
                      message.usage.tokens.cache.read +
                      message.usage.tokens.cache.write,
                  cost: message.usage.cost,
                  costComplete: "costComplete" in message.usage ? message.usage.costComplete !== false : true,
                },
              }),
          ...(message.time.completed === undefined
            ? {}
            : {
                durationMs: Math.max(0, message.time.completed.getTime() - message.time.created.getTime()),
                completedAt: message.time.completed.getTime(),
              }),
        }
  return {
    id: message.id,
    parts: (message.content ?? []).map((part, index) => presentMessagePart(part, part.id || `${message.id}:${index}`)),
    streaming: message.finish === undefined && message.time.completed === undefined,
    cancelling: entry.activity?.state === "cancelling",
    ...(message.retry === undefined
      ? {}
      : { retry: { attempt: message.retry.attempt, at: message.retry.at.getTime() } }),
    ...(details === undefined ? {} : { details }),
    ...(message.error
      ? {
          error:
            message.error._tag === "SessionError.AbortedError"
              ? ({ type: "interrupted" } as const)
              : ({ type: "failed", failure: presentExecutionFailure(message.error, agent, friendlyModel) } as const),
        }
      : {}),
  }
}

function presentMessagePart(part: Extract<TranscriptMessage, { type: "assistant" }>["content"][number], id: string) {
  if (part.type === "text" || part.type === "reasoning") return { type: part.type, id, text: part.text }
  const input = parseRecord(part.state.input)
  const summary = parseSummary(input)
  return {
    type: "tool" as const,
    id,
    name: part.name,
    ...(summary === undefined ? {} : { summary }),
    input,
    metadata: "metadata" in part.state ? (part.state.metadata ?? {}) : {},
    ...(part.state.status === "streaming" ? { inputStreaming: true } : {}),
    state:
      part.state.status === "completed"
        ? parseSucceeded(part.state.result ?? part.state.content, part.state.result)
        : part.state.status === "error"
          ? part.state.error._tag === "SessionError.AbortedError"
            ? ({ type: "interrupted" } as const)
            : ({ type: "failed", message: parseError(part.state.error.message) } as const)
          : ({ type: "running" } as const),
  }
}

function attachAssistant(items: Array<SessionUI.Item>, assistant: SessionUI.AssistantMessage) {
  const turnIndex = items.findLastIndex((item) => item.type === "turn")
  const turn = items[turnIndex]
  if (turn?.type !== "turn" || turnIndex !== items.length - 1) {
    items.push({
      type: "turn",
      id: assistant.id,
      assistant: [assistant],
      state: assistantState(assistant),
    })
    return
  }
  items[turnIndex] = {
    ...turn,
    assistant: [...turn.assistant, assistant],
    state: assistantState(assistant),
  }
}

function assistantState(assistant: SessionUI.AssistantMessage): SessionUI.TurnState {
  if (assistant.error?.type === "interrupted") return { type: "interrupted" }
  if (assistant.error?.type === "failed") return { type: "failed", failure: assistant.error.failure }
  return assistant.streaming ? { type: "working" } : { type: "complete" }
}

function presentExecutionFailure(
  error: {
    readonly _tag: string
    readonly message: string
    readonly category?:
      | "auth"
      | "rate-limit"
      | "quota"
      | "content-filter"
      | "transport"
      | "internal"
      | "invalid-request"
      | "context-overflow"
      | "unknown"
    readonly status?: number
    readonly provider?: string
    readonly requestID?: string
    readonly responseBody?: string
    readonly bodyTruncated?: boolean
  },
  agent: string | undefined,
  model: string | undefined,
): SessionUI.ExecutionFailure {
  if (error._tag === "SessionError.ProviderError" && error.message === "Model request denied by policy")
    return {
      type: "policy",
      ...(agent === undefined ? {} : { agent: formatResource(agent) }),
      ...(model === undefined ? {} : { model }),
    }
  if (
    error._tag === "SessionError.ProviderError" &&
    error.category === "quota" &&
    error.provider === undefined &&
    /spend limit/i.test(error.message)
  )
    // A Budget refusal happens before any Provider is called, so it is not a Provider quota failure.
    return {
      type: "generic",
      message: parseError(error.message.replace(/^Provider: quota exceeded(?: \(\d+\))?: /, "")),
    }
  if (error._tag === "SessionError.ProviderError" && error.category !== undefined) {
    const description =
      {
        auth: "authentication failed",
        "rate-limit": "rate limit exceeded",
        quota: "quota exceeded",
        "content-filter": "content filter blocked the response",
        transport: "transport failed",
        internal: "internal error",
        "invalid-request": "invalid request",
        "context-overflow": "context window exceeded",
        unknown: "request failed",
      }[error.category] ?? "request failed"
    const summary = `${error.provider === undefined ? "Provider" : formatResource(error.provider)}: ${description}${error.status === undefined ? "" : ` (${error.status})`}`
    return {
      type: "provider",
      summary,
      message: parseError(
        error.message.startsWith(`${summary}: `) ? error.message.slice(summary.length + 2) : error.message,
      ),
      ...(error.requestID === undefined ? {} : { requestID: error.requestID }),
      ...(error.responseBody === undefined ? {} : { responseBody: error.responseBody }),
      ...(error.bodyTruncated === undefined ? {} : { bodyTruncated: error.bodyTruncated }),
    }
  }
  return { type: "generic", message: parseError(error.message) }
}

function parseSucceeded(output: unknown, result?: SessionUI.JsonValue): SessionUI.ToolState {
  const value = parseOutput(output)
  return {
    type: "succeeded",
    ...(value === undefined ? {} : { output: value }),
    ...(result === undefined ? {} : { result }),
  }
}

function parseSummary(input: SessionUI.JsonRecord) {
  return ["description", "query", "url", "filePath", "path", "pattern", "name"]
    .map((key) => input[key])
    .find((value): value is string => typeof value === "string" && value.length > 0)
}

function parseRecord(input: SessionUI.JsonValue | undefined): SessionUI.JsonRecord {
  return isJsonRecord(input) ? input : {}
}

function isJsonRecord(input: SessionUI.JsonValue | undefined): input is SessionUI.JsonRecord {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function parseOutput(output: unknown) {
  if (output === undefined) return undefined
  if (typeof output === "string") return output
  return JSON.stringify(output, null, 2) ?? "undefined"
}

function parseError(error: string) {
  const message = error.replace(/^Error:\s*/, "").trim()
  const parse = (value: string) => Option.getOrUndefined(decodeJson(value))
  const read = (value: string) => {
    const first = parse(value)
    return typeof first === "string" ? parse(first.trim()) : first
  }
  let json = read(message)
  if (json === undefined) {
    const start = message.indexOf("{")
    const end = message.lastIndexOf("}")
    if (start !== -1 && end > start) json = read(message.slice(start, end + 1))
  }
  if (!record(json)) return message

  const nested = record(json.error) ? json.error : undefined
  if (nested) {
    const type = typeof nested.type === "string" ? nested.type : undefined
    const detail = typeof nested.message === "string" ? nested.message : undefined
    if (type && detail) return `${type}: ${detail}`
    if (detail) return detail
    if (type) return type
    if (typeof nested.code === "string") return nested.code
  }
  if (typeof json.message === "string") return json.message
  if (typeof json.error === "string") return json.error
  return message
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
