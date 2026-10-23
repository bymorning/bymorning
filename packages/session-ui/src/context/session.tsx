import { createContext, useContext, type Accessor, type ParentProps } from "solid-js"

import type { SessionUI } from "../model.js"

type Focus = {
  readonly register: (key: string, focus: () => void) => () => void
  readonly focus: (key: string) => void
}

type Value = SessionUI.Provider & { readonly focus: Focus; readonly portal: Accessor<HTMLElement | undefined> }

const labels: SessionUI.Labels = {
  clear: "Clear",
  loading: "Loading session…",
  retry: "Retry",
  dismiss: "Dismiss",
  close: "Close",
  copy: "Copy",
  copyCode: "Copy code",
  codeCopied: "Code copied",
  copyMessage: "Copy message",
  copyResponse: "Copy response",
  interrupted: "Interrupted",
  permission: "Permission required",
  form: "Form required",
  send: "Send",
  stop: "Stop",
  attach: "Images and files",
  addToPrompt: "Add to prompt",
  placeholder: "Ask ByMorning",
  message: "Message",
  timeline: "Conversation timeline",
  prompt: "Prompt",
  compact: "Compact",
  agent: "Agent",
  model: "Model",
  variant: "Variant",
  cancel: "Cancel",
  back: "Back",
  submit: "Submit",
  allowOnce: "Once",
  allowAlways: "Always",
  reject: "Reject",
  rename: "Rename session",
  running: "Running",
  attachments: "Attachments",
  commands: "Commands",
  context: "Context",
  references: "References",
  skills: "Skills",
  agents: "Agents",
  files: "Files",
  searchingReferences: "Searching references…",
  noReferences: "No references found.",
  noCommands: "No commands found.",
  uploadFailed: "Upload failed",
  uploading: ({ path }) => `Uploading ${path}`,
  removeAttachment: ({ path }) => `Remove ${path}`,
  loadError: "Session could not be loaded.",
  invalidSession: "Invalid session ID.",
  notFound: "This session cannot be found.",
  emptyMessage: "No messages yet.",
  loadEarlier: "Load earlier messages",
  jumpToLatest: "Jump to latest message",
  nextMessage: "Next message",
  previousMessage: "Previous message",
  newSession: "New session",
  sessionTitle: "Session title",
  workspaceProject: "Project",
  workspaceProjectIn: "in workspace",
  statusLabel: ({ status }) => `Session status: ${status}`,
  toolFailed: "Failed",
  toolRunning: "Running",
  toolOutput: "Tool output",
  toolCopy: "Copy",
  toolCopied: "Copied",
  toolCopyError: "Copy error",
  toolCalled: "Called",
  toolCollapsed: "Collapsed",
  toolExpanded: "Expanded",
  toolRead: "Read",
  toolWrite: "Write",
  toolSearch: "Search",
  toolShell: "Shell",
  toolThinking: "Thinking",
  toolInterrupted: "interrupted",
  toolStopped: "stopped",
  backgroundWork: "Background work",
  backgroundOpen: "Open",
  backgroundWorking: "Working",
  backgroundTask: ({ count }) => (count === 1 ? "1 task in background" : `${count} tasks in background`),
}

const emptyTools = new Map<string, SessionUI.Tool>()
const noopFocus: Focus = { register: () => () => {}, focus: () => {} }
const defaultValue: Value = { tools: () => emptyTools, labels: () => labels, focus: noopFocus, portal: () => undefined }
const Context = createContext<Value>(defaultValue)

export function SessionProvider(props: ParentProps<Omit<SessionUI.ProviderProps, "children">>) {
  const parent = useContext(Context)
  const targets = new Map<string, () => void>()
  let root: HTMLDivElement | undefined
  // A supplied map is an intentional scoped replacement, not a global registry.
  const value: Value = {
    tools: () => props.tools ?? parent.tools(),
    labels: () => ({ ...parent.labels(), ...props.labels }),
    focus: {
      register: (key, focus) => {
        targets.set(key, focus)
        return () => targets.delete(key)
      },
      focus: (key) => targets.get(key)?.(),
    },
    portal: () => root,
  }
  return (
    <Context.Provider value={value}>
      <div
        ref={(element) => {
          root = element
        }}
        data-session-ui
      >
        {props.children}
      </div>
    </Context.Provider>
  )
}

export const useSession = () => useContext(Context)
