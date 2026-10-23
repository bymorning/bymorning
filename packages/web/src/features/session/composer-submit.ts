import type { SessionInfo } from "@bymorning/client"
import type { Agent } from "@bymorning/schema/agent"
import { createStore } from "solid-js/store"

import type { PromptTarget } from "../../context/prompt-state"
import { createPromptSubmissionState, type PromptSubmissionState } from "./prompt-submission-state"
import { ProjectFileReference } from "./ui/project-file-reference"
import type { ComposerModel } from "./ui/session-composer"
import type { ComposerAttachment } from "./ui/session-composer/model"

export type ComposerAdapter = {
  readonly state: PromptTarget
  readonly selection: () => ComposerSelection | undefined
  readonly pending: () => boolean
  readonly error: () => string | undefined
  readonly submit: (input: { readonly text: string; readonly submission: PromptSubmissionState }) => Promise<void>
  readonly interrupt?: () => Promise<void>
}

export type ComposerSelection = { readonly agent: Agent.ID; readonly model: SessionInfo["model"] }

export function composerBlank(text: string, attachments: ReadonlyArray<ComposerAttachment>) {
  return text.trim().length === 0 && !attachments.some((item) => item.state === "ready")
}

export function createComposerSubmitState() {
  const [state, setState] = createStore<{ validation: string | undefined }>({ validation: undefined })
  return { error: () => state.validation, setError: (error: string | undefined) => setState("validation", error) }
}

export function createComposerSubmit(input: {
  readonly adapter: ComposerAdapter
  readonly attachments: ComposerModel["attachments"]
  readonly state: ReturnType<typeof createComposerSubmitState>
}) {
  const { setError } = input.state

  const submit = async () => {
    if (input.adapter.pending()) return
    const target = input.adapter.state
    const ready = input.attachments.items().filter((item) => item.state === "ready")
    const text = target.current()
    const content = [text, ...ready.map((item) => ProjectFileReference.format(item.path))]
      .filter((part) => part.length > 0)
      .join("\n")
    if (composerBlank(text, ready)) return
    const selection = input.adapter.selection()
    if (!selection) {
      setError("An Agent and Model are required.")
      return
    }
    const submission = createPromptSubmissionState({
      target,
      selection,
      complete: () => {
        for (const item of ready) input.attachments.remove(item.id)
      },
    })
    setError(undefined)
    try {
      await input.adapter.submit({ text: content, submission })
    } catch {
      /* The native mutation owns the failure. */
    }
  }

  const stop = async () => {
    if (!input.adapter.interrupt || input.adapter.pending()) return
    setError(undefined)
    try {
      await input.adapter.interrupt()
    } catch {
      /* The native mutation owns the failure. */
    }
  }

  return { submit, stop, pending: input.adapter.pending, error: () => input.state.error() ?? input.adapter.error() }
}
