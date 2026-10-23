import type { FormAnswer, FormInfo, PermissionReplyInput, PermissionRequest } from "@bymorning/client"
import type { InboxItem, Message as ClientSolidMessage, SessionID, Submission } from "@bymorning/client/solid"
import type { Accessor, Component, JSX } from "solid-js"

/** Public values accepted by the Session UI. */
export namespace SessionUI {
  export type Action<I> = {
    readonly pending: Accessor<boolean>
    readonly error: Accessor<string | undefined>
    readonly run: (input: I) => void
  }

  export type Operation = {
    readonly pending: Accessor<boolean>
    readonly error: Accessor<string | undefined>
    readonly run: () => void
  }

  export type Row =
    | { readonly type: "message"; readonly key: string; readonly message: ClientSolidMessage }
    | { readonly type: "inbox"; readonly key: string; readonly item: InboxItem }
    | { readonly type: "submission"; readonly key: string; readonly submission: Submission }

  export type Select = {
    readonly value: Accessor<string | undefined>
    readonly choices: ReadonlyArray<{ readonly key: string; readonly label: string; readonly disabled?: boolean }>
    readonly action: Action<string>
  }

  export type Attachment = {
    readonly key: string
    readonly path: string
    readonly state: "uploading" | "ready" | "error"
    readonly error?: string
  }

  export type Attachments = {
    readonly items: Accessor<readonly Attachment[]>
    readonly disabled: Accessor<boolean>
    readonly add: (files: FileList) => void
    readonly remove: (key: string) => void
  }

  export type ToolPart = Extract<
    Extract<ClientSolidMessage, { readonly type: "assistant" }>["content"][number],
    { readonly type: "tool" }
  >
  export type Assistant = Extract<ClientSolidMessage, { readonly type: "assistant" }>
  export type ToolProps = {
    readonly assistant: Assistant
    readonly part: ToolPart
    readonly open: Accessor<boolean>
    readonly setOpen: (open: boolean) => void
    readonly onFileOpen?: (path: string) => void
    readonly sessionHref?: (sessionID: SessionID) => string | undefined
    readonly openSession?: (sessionID: SessionID) => void
  }

  export type Tool = {
    readonly render: Component<ToolProps>
    readonly failure?: Component<{ readonly error: string }>
  }

  export type Labels = {
    readonly clear: string
    readonly loading: string
    readonly retry: string
    readonly dismiss: string
    readonly close: string
    readonly copy: string
    readonly copyCode: string
    readonly codeCopied: string
    readonly copyMessage: string
    readonly copyResponse: string
    readonly interrupted: string
    readonly permission: string
    readonly form: string
    readonly send: string
    readonly stop: string
    readonly attach: string
    readonly addToPrompt: string
    readonly placeholder: string
    readonly message: string
    readonly timeline: string
    readonly prompt: string
    readonly compact: string
    readonly agent: string
    readonly model: string
    readonly variant: string
    readonly cancel: string
    readonly back: string
    readonly submit: string
    readonly allowOnce: string
    readonly allowAlways: string
    readonly reject: string
    readonly rename: string
    readonly running: string
    readonly attachments: string
    readonly commands: string
    readonly context: string
    readonly references: string
    readonly skills: string
    readonly agents: string
    readonly files: string
    readonly searchingReferences: string
    readonly noReferences: string
    readonly noCommands: string
    readonly uploadFailed: string
    readonly uploading: (input: { readonly path: string }) => string
    readonly removeAttachment: (input: { readonly path: string }) => string
    readonly loadError: string
    readonly invalidSession: string
    readonly notFound: string
    readonly emptyMessage: string
    readonly loadEarlier: string
    readonly jumpToLatest: string
    readonly nextMessage: string
    readonly previousMessage: string
    readonly newSession: string
    readonly sessionTitle: string
    readonly workspaceProject: string
    readonly workspaceProjectIn: string
    readonly statusLabel: (input: { readonly status: string }) => string
    readonly toolFailed: string
    readonly toolRunning: string
    readonly toolOutput: string
    readonly toolCopy: string
    readonly toolCopied: string
    readonly toolCopyError: string
    readonly toolCalled: string
    readonly toolCollapsed: string
    readonly toolExpanded: string
    readonly toolRead: string
    readonly toolWrite: string
    readonly toolSearch: string
    readonly toolShell: string
    readonly toolThinking: string
    readonly toolInterrupted: string
    readonly toolStopped: string
    readonly backgroundWork: string
    readonly backgroundOpen: string
    readonly backgroundWorking: string
    readonly backgroundTask: (input: { readonly count: number }) => string
  }

  export type Provider = {
    readonly tools: Accessor<ReadonlyMap<string, Tool>>
    readonly labels: Accessor<Labels>
  }

  export interface Timeline {
    readonly sessionID: Accessor<SessionID>
    readonly rows: Accessor<readonly Row[]>
    readonly loading: Accessor<boolean>
    readonly error: Accessor<string | undefined>
    readonly reload?: Operation
    readonly reasoning?: Accessor<boolean>
    readonly history?: { readonly more: Accessor<boolean>; readonly load: Operation }
    readonly submission?: {
      readonly retry: (submission: Submission) => Operation
      readonly dismiss: (submission: Submission) => void
    }
    readonly onFileOpen?: (path: string) => void
    readonly sessionHref?: (sessionID: SessionID) => string | undefined
    readonly openSession?: (sessionID: SessionID) => void
    readonly virtual?: boolean
  }

  export type ComposerProps = {
    readonly value: Accessor<string>
    readonly setValue: (value: string) => void
    readonly disabled: Accessor<boolean>
    readonly active: Accessor<boolean>
    readonly submit: Operation
    readonly compact: Operation
    readonly interrupt?: Operation
    readonly agents?: Select
    readonly models?: Select
    readonly variants?: Select
    readonly commands?: Accessor<
      readonly {
        readonly key: string
        readonly label: string
        readonly description?: string
        readonly action: Operation
      }[]
    >
    readonly mentions?: {
      readonly search: (
        query: string,
        signal: AbortSignal,
      ) => Promise<readonly { readonly key: string; readonly label: string; readonly insert: string }[]>
    }
    readonly attachments?: Attachments
  }

  export type PermissionProps = {
    readonly item: Accessor<PermissionRequest | undefined>
    readonly action: Action<Pick<PermissionReplyInput, "reply" | "message">>
  }

  export type FormProps = {
    readonly item: Accessor<FormInfo | undefined>
    readonly answer: Accessor<FormAnswer>
    readonly setAnswer: (key: string, value: FormAnswer[string] | undefined) => void
    readonly submit: Action<FormAnswer>
    readonly cancel: Operation
    readonly back?: Operation
  }

  export type HeaderProps = {
    readonly title: Accessor<string>
    readonly status: Accessor<"idle" | "running" | undefined>
    readonly identity: Accessor<{
      readonly workspace: string
      readonly project?: { readonly name: string; readonly avatar?: string }
    }>
    readonly usage?: Accessor<
      | { readonly tokens: number; readonly cost: number; readonly complete: boolean; readonly percentage?: number }
      | undefined
    >
    readonly rename?: Action<string>
  }

  export type ProviderProps = {
    readonly tools?: ReadonlyMap<string, Tool>
    readonly labels?: Partial<Labels>
    readonly children: JSX.Element
  }
}
