import { createEffect, createSignal, on, onCleanup, type JSX } from "solid-js"

import { connectComposerFocus } from "../../composer-model"
import type { ProjectFileReferenceEditorHandle } from "../project-file-reference"
import { ComposerAttachmentCommands } from "./attachment-commands"
import { ComposerAttachments } from "./attachments"
import {
  Context,
  type ComposerCompletion,
  type ComposerCommands as ComposerCommandRegistry,
  type ComposerContext,
} from "./context"
import { ComposerError } from "./error"
import { ComposerFrame } from "./frame"
import { ComposerInput } from "./input"
import type { ComposerModel } from "./model"
import { SessionSelection } from "../session-selection"
import { ComposerSlashCommands } from "./slash-commands"
import { autofocus } from "./reclaim-focus"
import { ComposerStop } from "./stop"
import { ComposerSubmit } from "./submit"
import "./session-composer.css"

export function Composer(props: { readonly model: ComposerModel; readonly autofocus?: boolean }): JSX.Element {
  let editor: ProjectFileReferenceEditorHandle | undefined
  let cancelAutofocus: (() => void) | undefined
  onCleanup(() => cancelAutofocus?.())
  const [completions, setCompletions] = createSignal<ReadonlyArray<ComposerCompletion>>([])
  const active = () => completions().find((completion) => completion.open())
  const commands: ComposerCommandRegistry = {
    active,
    register: (completion) => {
      setCompletions((items) => [...items, completion])
      return () => setCompletions((items) => items.filter((item) => item !== completion))
    },
    sync: (state) => {
      const selected = completions().find((completion) => completion.matches(state))
      for (const completion of completions()) {
        if (completion === selected) completion.sync(state)
        else completion.close()
      }
    },
    keydown: (event) => active()?.keydown(event) ?? false,
    close: () => {
      for (const completion of completions()) completion.close()
    },
    trigger: (trigger) => {
      const selected = completions().find((completion) => completion.trigger?.(trigger))
      for (const completion of completions()) {
        if (completion !== selected) completion.close()
      }
    },
  }
  const value: ComposerContext = {
    get value() {
      return props.model.value
    },
    get cursor() {
      return props.model.cursor
    },
    get error() {
      return props.model.error
    },
    get pending() {
      return props.model.pending
    },
    get command() {
      return props.model.command
    },
    get slashCommands() {
      return props.model.slashCommands
    },
    get selection() {
      return props.model.selection
    },
    get selectionVisibility() {
      return props.model.selectionVisibility
    },
    get projectFiles() {
      return props.model.projectFiles
    },
    get skills() {
      return props.model.skills
    },
    get agents() {
      return props.model.agents
    },
    get agentAttachments() {
      return props.model.agentAttachments
    },
    get attachments() {
      return props.model.attachments
    },
    get blank() {
      return props.model.blank
    },
    restoreFocus: () => editor?.focus(),
    get edit() {
      return props.model.edit
    },
    get submit() {
      return props.model.submit
    },
    get stop() {
      return props.model.stop
    },
    editor: () => editor,
    setEditor: (next) => {
      editor = next
      connectComposerFocus(props.model, next.focus)
      // Chrome drops programmatic focus fired while the triggering click's event is still being
      // dispatched; defer until click handling and the route transition have fully settled.
      if (props.autofocus) {
        cancelAutofocus?.()
        cancelAutofocus = autofocus(next.focus, 100)
      }
    },
    commands,
  }
  onCleanup(() => connectComposerFocus(props.model, undefined))
  // `pending` must only be tracked while a command exists (matches the old short-circuit), so an
  // idle composer does not close an open completion menu when pending flips.
  createEffect(
    on([() => value.command(), () => value.command() !== undefined && value.pending()], ([command, unavailable]) => {
      if (command !== undefined && !unavailable) return
      commands.close()
    }),
  )
  return (
    <Context.Provider value={value}>
      <ComposerFrame>
        <ComposerSlashCommands />
        <ComposerAttachmentCommands />
        <ComposerAttachments />
        <ComposerInput />
        <div data-slot="session-composer-footer">
          <SessionSelection
            model={props.model.selection}
            showAgent={false}
            showVariant={props.model.selectionVisibility.variant()}
          />
          <div data-slot="session-composer-status" aria-live="polite">
            <ComposerError />
          </div>
          <ComposerStop />
          <ComposerSubmit />
        </div>
      </ComposerFrame>
    </Context.Provider>
  )
}

export type { ComposerModel } from "./model"
