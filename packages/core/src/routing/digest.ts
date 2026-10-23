export * as RoutingDigest from "./digest.js"

import type { Message, SystemPart } from "@opencode-ai/ai/schema/messages"

/** Classification input derived from one model request's conversation. */
export interface Digest {
  /** Latest participant-written ask, with injected reminder and compaction-checkpoint blocks removed. */
  readonly ask: string
  /** Earlier participant-written asks, oldest first. Assistant, Tool, and lowered synthetic context is never included. */
  readonly history: ReadonlyArray<string>
  /** Rough token estimate of the whole request (four characters per token). */
  readonly tokens: number
  /** Whether any message carries image media. */
  readonly images: boolean
  /** Whether the newest non-assistant message carries participant-written text rather than only Tool results. */
  readonly human: boolean
  /** Stable text identifying the conversation up to and including the latest ask; equal across its Tool steps. */
  readonly turn: string
}

export const empty = { ask: "", history: [], tokens: 0, images: false, human: false, turn: "" } satisfies Digest

const reminder = /<system-reminder>[\s\S]*?<\/system-reminder>/gi
const checkpoint = /<conversation-checkpoint>[\s\S]*?<\/conversation-checkpoint>/gi

/** Remove complete injected reminder and compaction-checkpoint blocks and surrounding whitespace. */
export const strip = (text: string) => text.replace(reminder, "").replace(checkpoint, "").trim()

type Part = Message["content"][number]

const textOf = (parts: ReadonlyArray<Part>) =>
  parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")

/**
 * Nominal token estimate of one media part, calibrated on a high-detail image; providers charge
 * roughly 85–1,600 tokens per image depending on size and detail level.
 */
export const mediaTokens = 1_000

const size = (part: Part): number => {
  if (part.type === "text" || part.type === "reasoning") return part.text.length
  if (part.type === "tool-call") return JSON.stringify(part.input ?? null).length
  if (part.type === "tool-result") return JSON.stringify(part.result ?? null).length
  if (part.type === "media") return mediaTokens * 4
  return 0
}

/** Lowered synthetic context is user-role but never a participant ask. */
const synthetic = (message: Message) => message.role === "user" && message.metadata?.synthetic === true

/** Derive a classification Digest from canonical provider history. */
export const make = (messages: ReadonlyArray<Message>, system: ReadonlyArray<SystemPart> = []): Digest => {
  const asks: Array<{ readonly index: number; readonly text: string }> = []
  let chars = system.reduce((total, part) => total + part.text.length, 0)
  let images = false
  messages.forEach((message, index) => {
    for (const part of message.content) {
      chars += size(part)
      if (part.type === "media" && part.mediaType.startsWith("image/")) images = true
    }
    if (message.role !== "user" || synthetic(message)) return
    const text = strip(textOf(message.content))
    if (text.length > 0) asks.push({ index, text })
  })
  const last = asks.at(-1)
  const newest = messages.findLast((message) => message.role !== "assistant" && message.role !== "system")
  const human = newest !== undefined && last !== undefined && messages[last.index] === newest
  const turn =
    last === undefined
      ? ""
      : JSON.stringify([
          system.map((part) => part.text),
          messages
            .slice(0, last.index + 1)
            .map((message) => [message.role, message.role === "user" ? strip(textOf(message.content)) : textOf(message.content)]),
        ])
  return {
    ask: last?.text ?? "",
    history: asks.slice(0, -1).map((ask) => ask.text),
    tokens: Math.ceil(chars / 4),
    images,
    human,
    turn,
  }
}
