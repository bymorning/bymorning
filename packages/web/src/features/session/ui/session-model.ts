import type { DataSessionStatus } from "../../../context/data/session"

export namespace SessionUI {
  export type JsonValue = null | boolean | number | string | ReadonlyArray<JsonValue> | JsonRecord
  export type JsonRecord = { readonly [key: string]: JsonValue }
  export type Timeline =
    { readonly state: "loading" } | ProjectedTimeline | { readonly state: "failed"; readonly message: string }
  export type ProjectedTimeline = { readonly state: "ready"; readonly items: ReadonlyArray<Item> } & TimelineProjection
  export type Item = Turn | Notice
  export interface Notice {
    readonly type: "notice"
    readonly id: string
    readonly kind: "system" | "selection" | "compaction" | "policy"
    readonly effect?: "route" | "deny" | "transform"
    readonly messageID?: string
    readonly callID?: string
    readonly action?: string
    readonly resource?: string
    readonly policy?: string
    readonly rule?: number
    readonly created?: string
    readonly text: string
    readonly detail?: string
    readonly status?: "queued" | "running" | "completed" | "failed"
    readonly reason?: "manual" | "auto"
    readonly summary?: string
    readonly recent?: string
  }
  export interface Turn {
    readonly type: "turn"
    readonly id: string
    readonly user?: UserMessage
    readonly assistant: ReadonlyArray<AssistantMessage>
    readonly state: TurnState
  }
  export type TurnState =
    | { readonly type: "complete" }
    | { readonly type: "queued" }
    | { readonly type: "working" }
    | { readonly type: "interrupted" }
    | { readonly type: "failed"; readonly failure: ExecutionFailure }
  export type ExecutionFailure =
    | { readonly type: "generic"; readonly message: string }
    | {
        readonly type: "provider"
        readonly summary: string
        readonly message: string
        readonly requestID?: string
        readonly responseBody?: string
        readonly bodyTruncated?: boolean
      }
    | { readonly type: "policy"; readonly agent?: string; readonly model?: string }
  export interface UserMessage {
    readonly id: string
    readonly text: string
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly createdAt?: number
  }
  export interface AssistantMessage {
    readonly id: string
    readonly parts: ReadonlyArray<MessagePart>
    readonly streaming: boolean
    readonly cancelling?: boolean
    readonly retry?: { readonly attempt: number; readonly at: number }
    readonly details?: MessageDetails
    readonly error?: { readonly type: "failed"; readonly failure: ExecutionFailure } | { readonly type: "interrupted" }
  }
  export interface MessageDetails {
    readonly agent?: string
    readonly model: string
    readonly durationMs?: number
    readonly completedAt?: number
    readonly usage?: { readonly tokens: number; readonly cost: number; readonly costComplete: boolean }
  }
  export type MessagePart = TextPart | ReasoningPart | ToolPart
  export interface TextPart {
    readonly type: "text"
    readonly id: string
    readonly text: string
  }
  export interface ReasoningPart {
    readonly type: "reasoning"
    readonly id: string
    readonly text: string
  }
  export interface ToolPart {
    readonly type: "tool"
    readonly id: string
    readonly name: string
    readonly summary?: string
    readonly input: JsonRecord
    readonly metadata: JsonRecord
    readonly inputStreaming?: boolean
    readonly state: ToolState
  }
  export type ToolState =
    | { readonly type: "running" }
    | { readonly type: "succeeded"; readonly output?: string; readonly result?: JsonValue }
    | { readonly type: "failed"; readonly message: string }
    | { readonly type: "interrupted" }
    | { readonly type: "stopped" }
  export interface Preferences {
    readonly showAgent: boolean
    readonly showReasoning: boolean

    readonly showUsage: boolean
  }
  export interface AgentPresentation {
    readonly id: string
    readonly name: string
    readonly color?: string
  }
  export interface SubagentSession {
    readonly id: string
    readonly parentID?: string
    readonly title: string
    readonly archivedAt?: Date
    readonly createdAt: Date
  }
  export interface SubagentNavigation {
    readonly parentID: string
    readonly sessions: ReadonlyArray<SubagentSession>
  }
  export interface BackgroundTask {
    readonly id: string
    readonly kind: "subagent" | "shell"
    readonly title?: string
    readonly description?: string
    readonly color?: string
    readonly sessionID?: string
  }
  export interface TimelineActions {
    readonly openFile: (path: string) => void
    readonly sessionHref: (sessionID: string) => string | undefined
    readonly openSession: (sessionID: string) => void
    readonly sessionStatus: (sessionID: string) => DataSessionStatus
  }
  export interface TimelineProjection {
    readonly rows: ReadonlyArray<TimelineRow>
    readonly rowByKey: ReadonlyMap<string, TimelineRow>
    readonly userByID: ReadonlyMap<string, UserMessage>
    readonly noticeByID: ReadonlyMap<string, Notice>
    readonly partByKey: ReadonlyMap<string, TimelinePartEntry>
    readonly resolvePart: (messageID: string, partID: string) => TimelinePartEntry | undefined
    readonly messageFirstRowIndex: ReadonlyMap<string, number>
    readonly activeLastRowKey?: string
  }
  export interface TimelinePartRef {
    readonly messageID: string
    readonly partID: string
  }
  export interface TimelinePartEntry {
    readonly messageID: string
    readonly part: MessagePart
    readonly streaming: boolean
    readonly copyText?: string
    readonly details?: string
    readonly interrupted?: boolean
  }
  export type TimelinePartGroup =
    | { readonly type: "part"; readonly key: string; readonly ref: TimelinePartRef }
    | {
        readonly type: "context" | "file"
        readonly key: string
        readonly refs: ReadonlyArray<TimelinePartRef>
      }
  export type TimelineRow =
    | { readonly type: "turn-gap"; readonly key: string; readonly turnID: string }
    | { readonly type: "user-message"; readonly key: string; readonly turnID: string; readonly messageID: string }
    | {
        readonly type: "assistant-part"
        readonly key: string
        readonly turnID: string
        readonly group: TimelinePartGroup
        readonly previousAssistantPart: boolean
      }
    | { readonly type: "notice"; readonly key: string; readonly turnID: string; readonly noticeID: string }
    | { readonly type: "turn-divider"; readonly key: string; readonly turnID: string }
    | { readonly type: "error"; readonly key: string; readonly turnID: string; readonly failure: ExecutionFailure }
    | {
        readonly type: "retry"
        readonly key: string
        readonly turnID: string
        readonly messageID: string
        readonly attempt: number
        readonly at: number
      }
    | { readonly type: "thinking"; readonly key: string; readonly turnID: string }
}
