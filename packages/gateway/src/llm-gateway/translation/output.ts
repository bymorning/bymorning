export * as Output from "./output.js"

import type { LLMGateway } from "@bymorning/schema/llm-gateway"
import { Tokens } from "@bymorning/schema/usage"
import type { LLMEvent, Usage, FinishReason } from "@opencode-ai/ai/schema/events"
import { Effect, Option, Schema } from "effect"
import { StreamError } from "../failure.js"
import { UpstreamError } from "../failure.js"
import { adapters } from "../protocol.js"

type Block = {
  kind: "text" | "reasoning" | "tool"
  id: string
  index: number
  toolIndex: number
  text: string
  name: string
  input: unknown
  closed: boolean
}
type Frame = { event?: string; data: unknown } | { done: true }
const json = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))
const string = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))
const maximumBytes = 16 * 1024 * 1024
const opaque = Schema.Struct({
  signature: Schema.optionalKey(Schema.String),
  redactedData: Schema.optionalKey(Schema.String),
  encryptedContent: Schema.optionalKey(Schema.String),
})

/** Convert inclusive provider totals into the application's disjoint accounting categories. */
export const tokens = (usage: Usage | undefined): Tokens | undefined => {
  if (usage?.inputTokens === undefined || usage.outputTokens === undefined) return undefined
  const cacheRead = usage.cacheReadInputTokens ?? 0
  const cacheWrite = usage.cacheWriteInputTokens ?? 0
  const reasoning = usage.reasoningTokens ?? 0
  return Option.getOrUndefined(
    Schema.decodeUnknownOption(Tokens)({
      input: usage.nonCachedInputTokens ?? usage.inputTokens - cacheRead - cacheWrite,
      output: usage.outputTokens - reasoning,
      reasoning,
      cacheRead,
      cacheWrite,
    }),
  )
}

/** One invocation's bounded caller-format projection and streaming state. */
export const make = (protocol: LLMGateway.Protocol, model: string, requestID: string, created: number) => {
  const id = `${protocol === "openai-responses" ? "resp" : protocol === "anthropic-messages" ? "msg" : "chatcmpl"}_${requestID}`
  const blocks = new Map<string, Block>()
  const encoder = new TextEncoder()
  let bytes = 0
  let started = false
  let finished = false
  let reason = "unknown"
  let usage: Usage | undefined
  let sequence = 0
  let toolIndex = 0
  const chatReason = () =>
    reason === "tool-calls"
      ? "tool_calls"
      : reason === "length"
        ? "length"
        : reason === "content-filter"
          ? "content_filter"
          : "stop"
  const anthropicReason = () => (reason === "tool-calls" ? "tool_use" : reason === "length" ? "max_tokens" : "end_turn")
  const chatUsage = () =>
    usage === undefined
      ? undefined
      : {
          prompt_tokens: usage.inputTokens,
          completion_tokens: usage.outputTokens,
          total_tokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
          prompt_tokens_details: { cached_tokens: usage.cacheReadInputTokens ?? 0 },
          completion_tokens_details: { reasoning_tokens: usage.reasoningTokens ?? 0 },
        }
  const anthropicUsage = () =>
    usage === undefined
      ? undefined
      : {
          input_tokens:
            usage.nonCachedInputTokens ??
            (usage.inputTokens ?? 0) - (usage.cacheReadInputTokens ?? 0) - (usage.cacheWriteInputTokens ?? 0),
          output_tokens: usage.outputTokens,
          cache_read_input_tokens: usage.cacheReadInputTokens ?? 0,
          cache_creation_input_tokens: usage.cacheWriteInputTokens ?? 0,
        }
  const responseUsage = () =>
    usage === undefined
      ? undefined
      : {
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
          total_tokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
          input_tokens_details: { cached_tokens: usage.cacheReadInputTokens ?? 0 },
          output_tokens_details: { reasoning_tokens: usage.reasoningTokens ?? 0 },
        }
  const googleUsage = () =>
    usage === undefined
      ? undefined
      : {
          promptTokenCount: usage.inputTokens,
          candidatesTokenCount: (usage.outputTokens ?? 0) - (usage.reasoningTokens ?? 0),
          totalTokenCount: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
          cachedContentTokenCount: usage.cacheReadInputTokens ?? 0,
          thoughtsTokenCount: usage.reasoningTokens ?? 0,
        }
  const content = (block: Block) =>
    block.kind === "tool"
      ? { type: "tool_use", id: block.id, name: block.name, input: block.input }
      : block.kind === "reasoning"
        ? { type: "thinking", thinking: block.text }
        : { type: "text", text: block.text }
  const item = (block: Block, complete = true) =>
    block.kind === "tool"
      ? {
          type: "function_call",
          id: `fc_${block.id}`,
          call_id: block.id,
          name: block.name,
          arguments: complete ? string(block.input) : "",
          status: complete ? "completed" : "in_progress",
        }
      : block.kind === "reasoning"
        ? {
            type: "reasoning",
            id: `rs_${block.id}`,
            summary: complete ? [{ type: "summary_text", text: block.text }] : [],
          }
        : {
            type: "message",
            id: `msg_${block.id}`,
            role: "assistant",
            status: complete ? "completed" : "in_progress",
            content: complete ? [{ type: "output_text", text: block.text, annotations: [] }] : [],
          }
  const response = (status = finished ? (reason === "length" ? "incomplete" : "completed") : "in_progress") => ({
    id,
    object: "response",
    created_at: created,
    model,
    status,
    error: null,
    incomplete_details: reason === "length" ? { reason: "max_output_tokens" } : null,
    output: Array.from(blocks.values(), (block) => item(block)),
    usage: responseUsage(),
  })
  const value = (): Record<string, unknown> => {
    const all = Array.from(blocks.values())
    if (protocol === "openai-responses") return response()
    if (protocol === "anthropic-messages")
      return {
        id,
        type: "message",
        role: "assistant",
        model,
        content: all.map(content),
        stop_reason: anthropicReason(),
        stop_sequence: null,
        usage: anthropicUsage(),
      }
    if (protocol === "google-generate")
      return {
        responseId: id,
        modelVersion: model,
        candidates: [
          {
            index: 0,
            content: {
              role: "model",
              parts: all.map((block) =>
                block.kind === "tool"
                  ? { functionCall: { id: block.id, name: block.name, args: block.input } }
                  : { text: block.text, ...(block.kind === "reasoning" ? { thought: true } : {}) },
              ),
            },
            finishReason: reason === "length" ? "MAX_TOKENS" : reason === "content-filter" ? "SAFETY" : "STOP",
          },
        ],
        usageMetadata: googleUsage(),
      }
    const tools = all.filter((block) => block.kind === "tool")
    const reasoning = all
      .filter((block) => block.kind === "reasoning")
      .map((block) => block.text)
      .join("")
    return {
      id,
      object: "chat.completion",
      created,
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content:
              all
                .filter((block) => block.kind === "text")
                .map((block) => block.text)
                .join("") || null,
            ...(reasoning ? { reasoning_content: reasoning } : {}),
            ...(tools.length
              ? {
                  tool_calls: tools.map((block) => ({
                    id: block.id,
                    type: "function",
                    function: { name: block.name, arguments: string(block.input) },
                  })),
                }
              : {}),
          },
          finish_reason: chatReason(),
        },
      ],
      usage: chatUsage(),
    }
  }
  const frames = (event: LLMEvent): Frame[] => {
    const result: Frame[] = []
    const emit = (data: unknown, event?: string) => result.push({ data, ...(event === undefined ? {} : { event }) })
    const responsesEvent = (type: string, data: Record<string, unknown>) =>
      emit({ type, sequence_number: sequence++, ...data }, type)
    const chatDelta = (delta: unknown, finish_reason: string | null = null) =>
      emit({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason }] })
    if (!started) {
      started = true
      if (protocol === "openai-chat") chatDelta({ role: "assistant", content: "" })
      if (protocol === "anthropic-messages")
        emit(
          {
            type: "message_start",
            message: {
              id,
              type: "message",
              role: "assistant",
              model,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 },
            },
          },
          "message_start",
        )
      if (protocol === "openai-responses") {
        responsesEvent("response.created", { response: response() })
        responsesEvent("response.in_progress", { response: response() })
      }
    }
    const start = (kind: Block["kind"], id: string, name = "") => {
      const key = `${kind}:${id}`
      const existing = blocks.get(key)
      if (existing) return existing
      const block = {
        kind,
        id,
        name,
        index: blocks.size,
        toolIndex: kind === "tool" ? toolIndex++ : -1,
        text: "",
        input: {},
        closed: false,
      }
      blocks.set(key, block)
      if (protocol === "anthropic-messages")
        emit({ type: "content_block_start", index: block.index, content_block: content(block) }, "content_block_start")
      if (protocol === "openai-chat" && kind === "tool")
        chatDelta({ tool_calls: [{ index: block.toolIndex, id, type: "function", function: { name, arguments: "" } }] })
      if (protocol === "openai-responses") {
        responsesEvent("response.output_item.added", { output_index: block.index, item: item(block, false) })
        if (kind === "text")
          responsesEvent("response.content_part.added", {
            item_id: `msg_${id}`,
            output_index: block.index,
            content_index: 0,
            part: { type: "output_text", text: "", annotations: [] },
          })
        if (kind === "reasoning")
          responsesEvent("response.reasoning_summary_part.added", {
            item_id: `rs_${id}`,
            output_index: block.index,
            summary_index: 0,
            part: { type: "summary_text", text: "" },
          })
      }
      return block
    }
    const delta = (block: Block, text: string) => {
      bytes += encoder.encode(text).length
      block.text += text
      if (protocol === "openai-chat")
        chatDelta(
          block.kind === "tool"
            ? { tool_calls: [{ index: block.toolIndex, function: { arguments: text } }] }
            : block.kind === "reasoning"
              ? { reasoning_content: text }
              : { content: text },
        )
      if (protocol === "anthropic-messages")
        emit(
          {
            type: "content_block_delta",
            index: block.index,
            delta:
              block.kind === "tool"
                ? { type: "input_json_delta", partial_json: text }
                : block.kind === "reasoning"
                  ? { type: "thinking_delta", thinking: text }
                  : { type: "text_delta", text },
          },
          "content_block_delta",
        )
      if (protocol === "google-generate" && block.kind !== "tool")
        emit({
          responseId: id,
          modelVersion: model,
          candidates: [
            {
              index: 0,
              content: { role: "model", parts: [{ text, ...(block.kind === "reasoning" ? { thought: true } : {}) }] },
            },
          ],
        })
      if (protocol === "openai-responses") {
        const type =
          block.kind === "tool"
            ? "response.function_call_arguments.delta"
            : block.kind === "reasoning"
              ? "response.reasoning_summary_text.delta"
              : "response.output_text.delta"
        responsesEvent(type, {
          item_id: `${block.kind === "tool" ? "fc" : block.kind === "reasoning" ? "rs" : "msg"}_${block.id}`,
          output_index: block.index,
          ...(block.kind === "reasoning" ? { summary_index: 0 } : block.kind === "text" ? { content_index: 0 } : {}),
          delta: text,
        })
      }
    }
    const close = (block: Block) => {
      if (block.closed) return
      block.closed = true
      if (protocol === "anthropic-messages")
        emit({ type: "content_block_stop", index: block.index }, "content_block_stop")
      if (protocol === "openai-responses") {
        if (block.kind === "tool")
          responsesEvent("response.function_call_arguments.done", {
            item_id: `fc_${block.id}`,
            output_index: block.index,
            arguments: string(block.input),
          })
        if (block.kind === "text") {
          responsesEvent("response.output_text.done", {
            item_id: `msg_${block.id}`,
            output_index: block.index,
            content_index: 0,
            text: block.text,
          })
          responsesEvent("response.content_part.done", {
            item_id: `msg_${block.id}`,
            output_index: block.index,
            content_index: 0,
            part: { type: "output_text", text: block.text, annotations: [] },
          })
        }
        if (block.kind === "reasoning") {
          responsesEvent("response.reasoning_summary_text.done", {
            item_id: `rs_${block.id}`,
            output_index: block.index,
            summary_index: 0,
            text: block.text,
          })
          responsesEvent("response.reasoning_summary_part.done", {
            item_id: `rs_${block.id}`,
            output_index: block.index,
            summary_index: 0,
            part: { type: "summary_text", text: block.text },
          })
        }
        responsesEvent("response.output_item.done", { output_index: block.index, item: item(block) })
      }
    }
    if (event.type === "text-start" || event.type === "reasoning-start")
      start(event.type === "text-start" ? "text" : "reasoning", event.id)
    if (event.type === "text-delta" || event.type === "reasoning-delta")
      delta(start(event.type === "text-delta" ? "text" : "reasoning", event.id), event.text)
    if (event.type === "text-end" || event.type === "reasoning-end") {
      const block = start(event.type === "text-end" ? "text" : "reasoning", event.id)
      if (event.text !== undefined && event.text !== block.text) {
        if (!event.text.startsWith(block.text)) throw new Error("Provider rewrote already-streamed text")
        delta(block, event.text.slice(block.text.length))
      }
      close(block)
    }
    if (event.type === "tool-input-start") start("tool", event.id, event.name)
    if (event.type === "tool-input-delta") delta(start("tool", event.id, event.name), event.text)
    if (event.type === "tool-call") {
      const block = start("tool", event.id, event.name)
      block.input = event.input
      if (!block.text) delta(block, string(event.input))
      if (protocol === "google-generate")
        emit({
          responseId: id,
          modelVersion: model,
          candidates: [
            {
              index: 0,
              content: {
                role: "model",
                parts: [{ functionCall: { id: event.id, name: event.name, args: event.input } }],
              },
            },
          ],
        })
      close(block)
    }
    if (event.type === "step-finish" || event.type === "finish") usage = event.usage ?? usage
    if (event.type === "finish") {
      finished = true
      reason = event.reason.normalized
      for (const block of blocks.values()) close(block)
      if (protocol === "openai-chat") {
        chatDelta({}, chatReason())
        if (usage) emit({ id, object: "chat.completion.chunk", created, model, choices: [], usage: chatUsage() })
        result.push({ done: true })
      }
      if (protocol === "anthropic-messages") {
        emit(
          {
            type: "message_delta",
            delta: { stop_reason: anthropicReason(), stop_sequence: null },
            usage: anthropicUsage(),
          },
          "message_delta",
        )
        emit({ type: "message_stop" }, "message_stop")
      }
      if (protocol === "openai-responses")
        responsesEvent(reason === "length" ? "response.incomplete" : "response.completed", { response: response() })
      if (protocol === "google-generate")
        emit({
          responseId: id,
          modelVersion: model,
          candidates: [
            {
              index: 0,
              finishReason: reason === "length" ? "MAX_TOKENS" : reason === "content-filter" ? "SAFETY" : "STOP",
            },
          ],
          usageMetadata: googleUsage(),
        })
    }
    return result
  }
  return {
    value,
    usage: () => tokens(usage),
    complete: () => finished,
    failure: () =>
      protocol === "openai-responses"
        ? {
            type: "response.failed",
            sequence_number: sequence++,
            response: { ...response("failed"), error: { code: "server_error", message: "Upstream stream failed" } },
          }
        : adapters[protocol].error(new UpstreamError({ phase: "read", cause: "Provider stream failed" })).body,
    push: (event: LLMEvent) =>
      Effect.gen(function* () {
        if (finished) return yield* new StreamError({ cause: "Provider emitted data after completion" })
        if (event.type === "reasoning-start" || event.type === "reasoning-delta" || event.type === "reasoning-end") {
          for (const metadata of Object.values(event.providerMetadata ?? {})) {
            const state = Option.getOrUndefined(Schema.decodeUnknownOption(opaque)(metadata))
            if (
              state?.signature !== undefined ||
              state?.redactedData !== undefined ||
              state?.encryptedContent !== undefined
            )
              return yield* new StreamError({
                cause: "Opaque provider reasoning cannot be represented by this translation",
              })
          }
        }
        if (
          event.type === "tool-result" ||
          event.type === "tool-error" ||
          (event.type === "tool-call" && event.providerExecuted)
        )
          return yield* new StreamError({ cause: "Server-executed tools cannot be represented by this translation" })
        const output = yield* Effect.try({
          try: () => frames(event),
          catch: () => new StreamError({ cause: "Provider event could not be represented" }),
        })
        if (bytes > maximumBytes || blocks.size > 4096)
          return yield* new StreamError({ cause: "Provider response exceeded the size limit" })
        return yield* Effect.forEach(output, (frame) =>
          "done" in frame
            ? Effect.succeed(encoder.encode("data: [DONE]\n\n"))
            : json(frame.data).pipe(
                Effect.map((data) =>
                  encoder.encode(`${frame.event ? `event: ${frame.event}\n` : ""}data: ${data}\n\n`),
                ),
                Effect.mapError(() => new StreamError({ cause: "Provider reply could not be encoded" })),
              ),
        )
      }),
  }
}
