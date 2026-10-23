import type { Data } from "../../context/data"
import type { PromptTarget } from "../../context/prompt-state"
import { createAttachmentController } from "./attachment-controller"
import {
  composerBlank,
  createComposerSubmit,
  type ComposerAdapter,
  type createComposerSubmitState,
} from "./composer-submit"
import type { ComposerModel } from "./ui/session-composer"

const focusRegistrations = new WeakMap<ComposerModel, (focus: (() => void) | undefined) => void>()

export function createComposerModel(input: {
  readonly prompt: PromptTarget
  readonly submissionState: ReturnType<typeof createComposerSubmitState>
  readonly adapter: Omit<ComposerAdapter, "state">
  readonly command: ComposerModel["command"]
  readonly slashCommands?: ComposerModel["slashCommands"]
  readonly selection: ComposerModel["selection"]
  readonly selectionVisibility: ComposerModel["selectionVisibility"]
  readonly projectFiles: ComposerModel["projectFiles"]
  readonly skills: ComposerModel["skills"]
  readonly agents: ComposerModel["agents"]
  readonly write: Data["projectDirectory"]["write"]
  readonly directory: Pick<Data["projectDirectory"], "scope" | "query">
}): ComposerModel {
  const attachments = createAttachmentController({
    scope: input.projectFiles.scope,
    write: input.write,
    server: input.directory.scope,
    query: input.directory.query,
  })
  const submission = createComposerSubmit({
    state: input.submissionState,
    adapter: { ...input.adapter, state: input.prompt },
    attachments,
  })
  let focus: (() => void) | undefined
  let focusRequested = false
  const model: ComposerModel = {
    value: input.prompt.current,
    cursor: input.prompt.cursor,
    error: submission.error,
    pending: submission.pending,
    command: input.command,
    ...(input.slashCommands === undefined ? {} : { slashCommands: input.slashCommands }),
    selection: input.selection,
    selectionVisibility: input.selectionVisibility,
    projectFiles: input.projectFiles,
    skills: input.skills,
    agents: input.agents,
    agentAttachments: input.prompt.agents.current,
    attachments,
    blank: () => composerBlank(input.prompt.current(), attachments.items()),
    restoreFocus: () => {
      if (focus) {
        focus()
        return
      }
      focusRequested = true
    },
    edit: input.prompt.set,
    submit: submission.submit,
    stop: submission.stop,
  }
  focusRegistrations.set(model, (next) => {
    focus = next
    if (!focus || !focusRequested) return
    focusRequested = false
    queueMicrotask(focus)
  })
  return model
}

export function connectComposerFocus(model: ComposerModel, focus: (() => void) | undefined) {
  focusRegistrations.get(model)?.(focus)
}
