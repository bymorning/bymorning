import type { SessionEventPayload, SessionPromptInput } from "@bymorning/client"
import type { Data, InboxItem, Message, Submission } from "@bymorning/client/solid"
import type { Session } from "@bymorning/schema/session"
import { createMemo, mapArray, untrack, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"

import { errorMessage } from "../utils/error-message"
import type { PromptSelection } from "./prompt-state"

export type DurableMessage = Message
type DurableAssistant = Extract<Message, { readonly type: "assistant" }>
export type ClientAssistant = Omit<DurableAssistant, "agent" | "model" | "usage"> & {
  readonly agent?: NonNullable<DurableAssistant["agent"]>
  readonly model?: NonNullable<DurableAssistant["model"]>
  readonly usage?: NonNullable<DurableAssistant["usage"]>
}
export interface PendingUser {
  readonly type: "pending-user"
  readonly id: Message["id"]
  readonly sessionID: Message["sessionID"]
  readonly text: SessionPromptInput["text"]
  readonly agents: NonNullable<SessionPromptInput["agents"]>
  readonly admittedSequence?: number
  readonly createdAt: Date
}
export interface PendingCompaction {
  readonly type: "pending-compaction"
  readonly id: Message["id"]
  readonly sessionID: Message["sessionID"]
  readonly admittedSequence?: number
  readonly createdAt: Date
}
export type LocalActivity =
  | { readonly state: "queued" | "running" | "cancelling" }
  | { readonly state: "failed"; readonly message: string }
  | { readonly state: "cancelled" }
export type TranscriptMessage = Message | ClientAssistant | PendingUser | PendingCompaction
export const isDurableMessage = (message: TranscriptMessage): message is DurableMessage =>
  message.type !== "pending-user" &&
  message.type !== "pending-compaction" &&
  (message.type !== "assistant" || message.model !== undefined)
export interface PartRuntime {
  readonly key: `text:${string}` | `reasoning:${string}` | `tool:${string}`
  readonly sequence: number
  readonly phase: "open" | "ended" | "running" | "settled"
}
export interface TranscriptEntry {
  readonly message: TranscriptMessage
  readonly activity?: LocalActivity | undefined
  readonly parts: Readonly<Record<string, PartRuntime>>
  readonly origin: "server" | "local"
  readonly revision: number
}
/** Historical display only. Notices are supplied by the web-owned connection. */
export type SessionPolicyNotice = {
  readonly id: string
  readonly created: string
} & Extract<SessionEventPayload, { readonly type: "session.policy.enforced" }>["data"]
export interface SessionPromptOperationInput {
  readonly text: SessionPromptInput["text"]
  readonly agents: NonNullable<SessionPromptInput["agents"]>
  readonly selection: PromptSelection
}
export type SessionInbox =
  | { readonly state: "idle" | "loading" }
  | { readonly state: "ready"; readonly data: ReadonlyArray<InboxItem> }
  | { readonly state: "error"; readonly message: string }
export type SessionTranscript =
  | { readonly state: "idle" | "loading" }
  | {
      readonly state: "ready"
      readonly data: ReadonlyArray<TranscriptEntry>
      readonly cursor?: string | undefined
      readonly loadingOlder: boolean
      readonly olderError?: string | undefined
    }
  | { readonly state: "error"; readonly message: string }
export type SessionReadiness =
  | { readonly state: "idle" | "loading" }
  | { readonly state: "ready" }
  | { readonly state: "error"; readonly message: string }
export interface SessionProjection {
  readonly transcript: Accessor<SessionTranscript>
  readonly inbox: Accessor<SessionInbox>
  readonly topology: Accessor<number>
  readonly entry: (messageID: string) => TranscriptEntry | undefined
  readonly windowReplacement: Accessor<number>
  readonly loadOlder: () => Promise<void>
}

function parts(message: TranscriptMessage): TranscriptEntry["parts"] {
  if (message.type !== "assistant") return {}
  const incomplete = message.finish === undefined && message.time.completed === undefined
  return Object.fromEntries(
    (message.content ?? []).map((part, index) => {
      const key: PartRuntime["key"] = `${part.type}:${part.id}`
      const phase: PartRuntime["phase"] =
        part.type === "tool"
          ? part.state.status === "streaming"
            ? "open"
            : part.state.status === "running"
              ? "running"
              : "settled"
          : incomplete
            ? "open"
            : "ended"
      return [key, { key, sequence: message.sequence + index / Math.max(message.content.length, 1), phase }]
    }),
  )
}

function entryTopology(entry: TranscriptEntry) {
  const message = entry.message
  if (message.type !== "assistant")
    return `${message.type}:${message.id}:${entry.revision}:${entry.activity?.state ?? ""}`
  return [
    message.id,
    message.finish ?? "",
    message.time.completed?.getTime() ?? "",
    message.retry?.attempt ?? "",
    message.retry?.at.getTime() ?? "",
    message.error?._tag ?? "",
    entry.activity?.state ?? "",
    JSON.stringify([message.agent, message.model, message.usage, message.error]),
    ...(message.content ?? []).map((part) =>
      part.type === "text" || part.type === "reasoning"
        ? `${part.type}:${part.id}:${/\S/.test(part.text) ? "visible" : "empty"}`
        : `tool:${part.id}:${part.name}:${part.state.status}:${"metadata" in part.state && Array.isArray(part.state.metadata?.loaded) ? "loaded" : ""}`,
    ),
  ].join("|")
}

function projected(
  message: Accessor<TranscriptMessage>,
  origin: TranscriptEntry["origin"],
  activity: Accessor<LocalActivity | undefined>,
  nextRevision: () => number,
) {
  // Track this row's nested fields, without copying or owning its canonical Message.
  // mapArray gives each row its own owner, so a token only revises that row.
  const revision = createMemo(() => {
    JSON.stringify([message(), activity()])
    return nextRevision()
  })
  const runtime = createMemo(() => parts(message()))
  const entry: TranscriptEntry = {
    get message() {
      return message()
    },
    get activity() {
      return activity()
    },
    get parts() {
      return runtime()
    },
    get revision() {
      return revision()
    },
    origin,
  }
  return { id: untrack(() => message().id), entry, topology: createMemo(() => entryTopology(entry)) }
}

function pending(item: Exclude<InboxItem, { readonly type: "synthetic" }>): PendingUser | PendingCompaction {
  const common = {
    id: item.id,
    sessionID: item.sessionID,
    createdAt: item.createdAt,
    admittedSequence: item.admittedSequence,
  }
  if (item.type === "user")
    return { ...common, type: "pending-user", text: item.payload.text, agents: item.payload.agents ?? [] }
  return { ...common, type: "pending-compaction" }
}
function submission(item: Submission): PendingUser | PendingCompaction {
  const common = { id: item.id, sessionID: item.sessionID, createdAt: item.createdAt }
  return item.type === "prompt"
    ? { ...common, type: "pending-user", text: item.input.text, agents: item.input.agents ?? [] }
    : { ...common, type: "pending-compaction" }
}
function submissionActivity(item: Submission): LocalActivity {
  if (item.state.state === "sending") return { state: "running" }
  const message = failure(item.state.error, "Submission failed")
  return { state: "failed", message: item.state.state === "uncertain" ? `Delivery is uncertain. ${message}` : message }
}

function failure(cause: unknown, fallback: string) {
  return typeof cause === "object" && cause !== null && "message" in cause && typeof cause.message === "string"
    ? cause.message
    : errorMessage(cause, fallback)
}

/** Presentation only: all Message, Inbox, and Submission authority remains in Data. */
export function createSessionProjection(
  shared: Data,
  sessionID: Session.ID,
  readiness: Accessor<SessionReadiness>,
): SessionProjection {
  const [presentation, setPresentation] = createStore<{ olderError: string | undefined }>({ olderError: undefined })
  let revision = 0
  const nextRevision = () => ++revision
  const messages = mapArray(
    () => shared.session.message.list(sessionID),
    (row) =>
      projected(
        () => row,
        "server",
        () => undefined,
        nextRevision,
      ),
  )
  const admitted = mapArray(
    () => shared.session.inbox.list(sessionID).filter((row) => row.type !== "synthetic"),
    (row) =>
      projected(
        () => pending(row),
        "server",
        () => ({ state: "queued" }),
        nextRevision,
      ),
  )
  const submissions = mapArray(
    () => shared.session.submission.list(sessionID),
    (row) =>
      projected(
        () => submission(row),
        "local",
        () => submissionActivity(row),
        nextRevision,
      ),
  )
  const rows = createMemo(() => {
    const durable = messages()
    const seen = new Set<string>(durable.map((row) => row.id))
    const pending = [...admitted(), ...submissions()].filter((row) => {
      if (seen.has(row.id)) return false
      seen.add(row.id)
      return true
    })
    return [...durable, ...pending]
  })
  const entries = createMemo(() => rows().map((row) => row.entry))
  const byID = createMemo(() => new Map<string, TranscriptEntry>(rows().map((row) => [row.id, row.entry])))
  const shape = createMemo(
    () =>
      JSON.stringify(readiness()) +
      rows()
        .map((row) => row.topology())
        .join("\n"),
  )
  let generation = -1
  const topology = createMemo(() => {
    shape()
    return ++generation
  })
  let previous: readonly string[] = []
  let replacements = 0
  const windowReplacement = createMemo(() => {
    const ids = messages().map((row) => row.id)
    const retained = new Set<string>(ids)
    // Prepending older history or appending live work preserves the current window.
    if (previous.some((id) => !retained.has(id))) replacements++
    previous = ids
    return replacements
  })
  const transcript = createMemo<SessionTranscript>(() => {
    const ready = readiness()
    if (ready.state !== "ready") return ready
    return {
      state: "ready",
      data: entries(),
      cursor: shared.session.message.more(sessionID) ? "older" : undefined,
      loadingOlder: shared.session.message.loading(sessionID),
      olderError: presentation.olderError,
    }
  })
  return {
    transcript,
    inbox: () => {
      const ready = readiness()
      return ready.state === "ready" ? { state: "ready", data: shared.session.inbox.list(sessionID) } : ready
    },
    topology,
    entry: (id) => byID().get(id),
    windowReplacement,
    loadOlder: async () => {
      setPresentation("olderError", undefined)
      try {
        await shared.session.message.load(sessionID)
      } catch (cause) {
        setPresentation("olderError", failure(cause, "Could not load older messages"))
      }
    },
  }
}
