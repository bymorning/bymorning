import { Message, ProviderMetadata, ReasoningPart, TextPart, ToolCallPart } from "@opencode-ai/ai/schema/messages"
import type { Message as SessionMessage } from "@bymorning/schema/message"
import { Schema } from "effect"

const providerMetadata = (value: unknown) =>
  value === undefined ? {} : { providerMetadata: Schema.decodeUnknownSync(ProviderMetadata)(value) }

export interface HistoryOptions {
  /**
   * Replay the provider's opaque continuation state (reasoning items, encrypted
   * reasoning, item identifiers). `false` replays only the visible conversation,
   * for a provider that can no longer verify state it previously issued.
   */
  readonly continuation?: boolean
  /**
   * The Model about to receive this history. Continuation state issued by a
   * different Model (reasoning signatures, encrypted reasoning, item
   * identifiers) is dropped so a routed Model never verifies another's state.
   */
  readonly model?: { readonly provider: string; readonly id: string }
}

/** Lower durable Messages into canonical OpenCode provider history. */
export const fromHistory = (
  messages: ReadonlyArray<SessionMessage>,
  options: HistoryOptions = {},
): ReadonlyArray<Message> => {
  const replay = options.continuation ?? true
  return messages.flatMap((message) => {
    if (message.type === "user")
      return [
        Message.make({
          id: message.id,
          role: "user",
          content: message.text,
          ...(message.metadata === undefined && !message.agents?.length
            ? {}
            : { metadata: { ...message.metadata, ...(message.agents?.length ? { agents: message.agents } : {}) } }),
        }),
      ]
    // Synthetic context is user-role but never participant-written; the tag lets Routing skip it as an ask.
    if (message.type === "synthetic")
      return [Message.make({ role: "user", content: message.text, metadata: { synthetic: true } })]
    if (message.type === "system") return [Message.system(message.text)]
    if (message.type === "compaction")
      return message.status === "completed"
        ? [
            Message.user(
              `<conversation-checkpoint>\n${message.summary}${message.recent.length === 0 ? "" : `\n\n${message.recent}`}\n</conversation-checkpoint>`,
            ),
          ]
        : []
    if (message.type !== "assistant") return []
    const continuation =
      replay &&
      (options.model === undefined ||
        (options.model.provider === message.model.provider && options.model.id === message.model.id))
    const metadata = (value: unknown) => (continuation ? providerMetadata(value) : {})
    const assistant = Array<TextPart | ReasoningPart | ToolCallPart>()
    const tools = Array<Message>()
    for (const part of message.content) {
      if (part.type === "text") {
        assistant.push(TextPart.make({ type: "text", text: part.text, ...metadata(part.providerMetadata) }))
        continue
      }
      if (part.type === "reasoning") {
        if (continuation)
          assistant.push(
            ReasoningPart.make({ type: "reasoning", text: part.text, ...providerMetadata(part.providerMetadata) }),
          )
        continue
      }
      if (part.state.status === "streaming") continue
      assistant.push(
        ToolCallPart.make({
          id: part.id,
          name: part.name,
          input: part.state.input,
          providerExecuted: part.providerExecuted,
          ...metadata(part.providerMetadata),
        }),
      )
      if (part.providerExecuted === true) continue
      if (part.state.status === "completed")
        tools.push(
          Message.tool({
            id: part.id,
            name: part.name,
            result: { type: "content", value: part.state.content },
            ...(part.state.metadata === undefined ? {} : { metadata: part.state.metadata }),
          }),
        )
      else if (part.state.status === "error")
        tools.push(
          Message.tool({
            id: part.id,
            name: part.name,
            result: { type: "error", value: part.state.error.message },
            ...(part.state.metadata === undefined ? {} : { metadata: part.state.metadata }),
          }),
        )
    }
    return [...(assistant.length === 0 ? [] : [Message.assistant(assistant)]), ...tools]
  })
}
