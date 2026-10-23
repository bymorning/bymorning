import { I18nProvider as KobalteProvider } from "@kobalte/core/i18n"
import { createContext, useContext, type Accessor, type ParentProps } from "solid-js"

const fallback = {
  "ui.actionMenu.label": ({ label }: { readonly label: string }) => `Actions for ${label}`,
  "ui.fileTree.label": "Project files",
  "ui.confirm.cancel": "Cancel",
  "ui.confirm.confirm": "Confirm",
  "ui.confirm.failure": ({ label }: { readonly label: string }) => `Could not ${label.toLowerCase()}`,
  "ui.confirm.error": "Something went wrong.",
  "ui.searchSelect.label": "Model",
  "ui.searchSelect.search": ({ label }: { readonly label: string }) => `Search ${label.toLowerCase()}s`,
  "ui.searchSelect.empty": ({ label }: { readonly label: string }) => `No ${label.toLowerCase()}s found`,
  "ui.searchSelect.clear": ({ label }: { readonly label: string }) => `Clear ${label.toLowerCase()} search`,
  "ui.common.clear": "Clear",
  "ui.common.dismiss": "Dismiss",
  "ui.common.close": "Close",
  "ui.common.retry": "Retry",
  "ui.message.copy": "Copy",
  "ui.message.copyMessage": "Copy message",
  "ui.message.copyResponse": "Copy response",
  "ui.message.interrupted": "Interrupted",
  "ui.session.sidebar": "Right sidebar",
  "ui.session.composer.prompt": "Prompt",
  "ui.session.composer.message": "Message",
  "ui.session.composer.placeholder": "Ask ByMorning",
  "ui.session.composer.add": "Add to prompt",
  "ui.session.composer.attach": "Images and files",
  "ui.session.composer.commands": "Commands",
  "ui.session.composer.context": "Context",
  "ui.session.composer.attachments": "Attachments",
  "ui.session.composer.references": "References",
  "ui.session.composer.skills": "Skills",
  "ui.session.composer.agents": "Agents",
  "ui.session.composer.files": "Files",
  "ui.session.composer.searchingReferences": "Searching references...",
  "ui.session.composer.referencesError": "Project files could not be searched. Keep typing to try again.",
  "ui.session.composer.noReferences": "No references found.",
  "ui.session.composer.noCommands": "No commands found.",
  "ui.session.composer.uploadFailed": "Upload failed",
  "ui.session.composer.uploading": ({ path }: { readonly path: string }) => `Uploading ${path}`,
  "ui.session.composer.removeAttachment": ({ path }: { readonly path: string }) => `Remove ${path}`,
  "ui.session.composer.fileType.file": "File",
  "ui.session.composer.fileType.javascript": "JavaScript",
  "ui.session.composer.fileType.json": "JSON",
  "ui.session.composer.fileType.markdown": "Markdown",
  "ui.session.composer.fileType.pdf": "PDF",
  "ui.session.composer.fileType.source": "Source file",
  "ui.session.composer.fileType.text": "Text",
  "ui.session.composer.fileType.typescript": "TypeScript",
  "ui.session.background.hint": "Continue in background",
  "ui.session.background.hintLabel": ({ shortcut }: { readonly shortcut: string }) =>
    `Continue in background ${shortcut}`,
  "ui.session.background.keybind": "Ctrl+B",
  "ui.session.background.heading": "Background work",
  "ui.session.background.summary": ({ count }: { readonly count: number }) =>
    count === 1 ? "1 task in background" : `${count} tasks in background`,
  "ui.session.background.working": "Working",
  "ui.session.background.shell": "Shell",
  "ui.session.background.subagent": "Subagent",
  "ui.session.background.shellCommand": "Shell command",
  "ui.session.background.delegatedTask": "Delegated task",
  "ui.session.background.command": "Continue in background",
  "ui.session.background.commandDescription": "Let active subagents continue while you work elsewhere",
  "ui.session.background.commandError": "Could not continue in background. Try again.",
  "ui.session.background.commandCategory": "Session",
  "ui.session.background.open": "Open",
  "ui.session.background.openTask": ({ title }: { readonly title: string }) => `Open background task ${title}`,
  "ui.session.background.taskLabel": ({
    kind,
    title,
    description,
    status,
  }: {
    readonly kind: string
    readonly title: string
    readonly description: string
    readonly status: string
  }) => `${kind} ${title} ${description} ${status}`,
  "ui.session.invalid": "Invalid session ID.",
  "ui.session.loading": "Loading session...",
  "ui.session.loadError": "Session could not be loaded.",
  "ui.session.notFound": "This session cannot be found.",
  "ui.session.loadingPrompt": "Loading prompt...",
  "ui.session.promptAdmissionUnknown": "Prompt admission failed. Your draft was preserved.",
  "ui.session.retryScheduled": ({ attempt, scheduled }: { readonly attempt: number; readonly scheduled: string }) =>
    `Retrying · attempt ${attempt} · scheduled ${scheduled}`,
  "ui.message": "Messages",
  "ui.message.empty": "No messages yet.",
  "ui.message.jumpToLatest": "Jump to latest message",
  "ui.message.next": "Next message",
  "ui.message.nextDescription": "Go to the next user message",
  "ui.message.previous": "Previous message",
  "ui.message.previousDescription": "Go to the previous user message",
  "ui.session.new": "New session",
  "ui.session.parent": "Parent session",
  "ui.session.rename": "Rename session",
  "ui.session.renameError": "Session could not be renamed.",
  "ui.session.session": "Session",
  "ui.session.status.attention": "Needs attention",
  "ui.session.status.running": "Running",
  "ui.session.status.unread": "Unread",
  "ui.session.status.working": "Working",
  "ui.session.statusLabel": ({ status }: { readonly status: string }) => `Session status: ${status}`,
  "ui.session.title": "Session title",
  "ui.session.untitledProject": "Untitled project",
  "ui.session.workspaceProject": "Project",
  "ui.session.workspaceProjectIn": "in workspace",
  "ui.tool.applyPatch": "Apply patch",
  "ui.tool.additions": "additions",
  "ui.tool.called": "Called",
  "ui.tool.collapsed": "Collapsed",
  "ui.tool.copy": "Copy",
  "ui.tool.copyError": "Copy error",
  "ui.tool.copied": "Copied",
  "ui.tool.created": "Created",
  "ui.tool.diffFor": "Diff for",
  "ui.tool.deletions": "deletions",
  "ui.tool.edit": "Edit",
  "ui.tool.execute": "Execute",
  "ui.tool.expanded": "Expanded",
  "ui.tool.explored": "Explored",
  "ui.tool.exploring": "Exploring",
  "ui.tool.failed": "Failed",
  "ui.tool.files": "files",
  "ui.tool.file": "file",
  "ui.tool.glob": "Glob",
  "ui.tool.grep": "Grep",
  "ui.tool.list": "List",
  "ui.tool.listSummary": "list",
  "ui.tool.lists": "lists",
  "ui.tool.loaded": "Loaded",
  "ui.tool.loadedSkill": "Loaded __BYMORNING_LOADED_SKILL__ skill",
  "ui.tool.openFile": "Open file",
  "ui.tool.output": "Tool output",
  "ui.tool.read": "Read",
  "ui.tool.readSummary": "read",
  "ui.tool.reads": "reads",
  "ui.tool.search": "search",
  "ui.tool.searches": "searches",
  "ui.tool.shell": "Shell",
  "ui.tool.shell.writingCommand": "Writing command...",
  "ui.tool.skill": "Skill",
  "ui.tool.thinking": "Thinking",
  "ui.tool.tool": "Tool",
  "ui.tool.interrupted": "interrupted",
  "ui.tool.stopped": "stopped",
  "ui.tool.subagent.defaultAgent": "Subagent",
  "ui.tool.subagent.delegatedTask": "Delegated task",
  "ui.tool.subagent.delegating": "Delegating",
  "ui.tool.subagent.running": "Running",
  "ui.tool.subagent.runningBackground": "Running in background",
  "ui.tool.subagent.completed": "Completed",
  "ui.tool.subagent.cancelled": "Cancelled",
  "ui.tool.subagent.error": ({ message }: { readonly message: string }) => `Error: ${message}`,
  "ui.tool.subagent.backgroundSuffix": "(background)",
  "ui.tool.subagent.label": ({
    agent,
    description,
    status,
  }: {
    readonly agent: string
    readonly description: string
    readonly status: string
  }) => `${agent} ${description} ${status}`,
  "ui.tool.write": "Write",
  "ui.lineComment.contextPlaceholder": "Add context for this change",
  "ui.lineComment.submit": "Comment",
  "ui.lineComment.cancel": "Cancel",
} as const

type BmUiI18nKey = keyof typeof fallback

type BmUiI18nArgs<K extends BmUiI18nKey> = (typeof fallback)[K] extends (...args: infer A) => string ? A : []

type BmUiI18nCatalog = {
  readonly [K in BmUiI18nKey]: (typeof fallback)[K] extends (...args: infer A) => string
    ? (...args: A) => string
    : string
}

type BmUiI18n = {
  locale: Accessor<string>
  t: <K extends BmUiI18nKey>(key: K, ...args: BmUiI18nArgs<K>) => string
}

export function createI18n(locale: Accessor<string> = () => "en", overrides: Partial<BmUiI18nCatalog> = {}): BmUiI18n {
  return {
    locale,
    t: (key, ...args) => {
      const message = overrides[key] ?? fallback[key]
      if (typeof message === "string") return message
      const translated: unknown = Reflect.apply(message, undefined, args)
      if (typeof translated === "string") return translated
      throw new TypeError(`Translation ${key} did not return a string`)
    },
  }
}

const defaultValue = createI18n()

const Context = createContext(defaultValue)

export function I18nProvider(props: ParentProps<{ value: BmUiI18n }>) {
  return (
    <KobalteProvider locale={props.value.locale()}>
      <Context.Provider value={props.value}>{props.children}</Context.Provider>
    </KobalteProvider>
  )
}

export function useI18n() {
  return useContext(Context)
}

export namespace I18n {
  export type Key = BmUiI18nKey
  export type Catalog = BmUiI18nCatalog
  export type Interface = BmUiI18n
}
