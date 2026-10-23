import { createEffect, on, type JSX } from "solid-js"

import { useI18n } from "../../../../ui/context/i18n"
import { ProjectFileReference } from "../project-file-reference"
import { useComposer } from "./context"
import { stop as ownsStop, submit as ownsSubmit } from "./interaction"
import "./input.css"

/** Draft limit: about 75k words (a long pasted document); the prompt route accepts 10 MiB. */
export const draftLimit = 500_000

export function ComposerInput(): JSX.Element {
  const composer = useComposer()
  const language = useI18n()
  const disabled = () => composer.command() === undefined || composer.pending()
  // The editor stops being editable while a submission is pending, which drops browser focus.
  // Remember that it held focus and give it back once editing is possible again.
  let focused = false
  createEffect(
    on(
      disabled,
      (off, wasOff) => {
        if (off || !wasOff || !focused) return
        const active = document.activeElement
        if (active === null || active === document.body) composer.restoreFocus()
      },
      { defer: true },
    ),
  )
  const onKeyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (event) => {
    focused = true
    if (composer.commands.keydown(event)) return
    const input = {
      key: event.key,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      defaultPrevented: event.defaultPrevented,
      isComposing: event.isComposing,
    }
    if (ownsStop(input, composer.command())) {
      event.preventDefault()
      void composer.stop()
      return
    }
    if (!ownsSubmit(input)) return
    event.preventDefault()
    event.currentTarget.closest("form")?.requestSubmit()
  }
  return (
    <div data-component="session-composer-input">
      <ProjectFileReference.Editor
        value={composer.value()}
        cursor={composer.cursor()}
        paths={composer.projectFiles.list()}
        skills={composer.skills() ?? []}
        agents={composer.agentAttachments()}

        disabled={disabled()}
        label={language.t("ui.session.composer.message")}
        placeholder={language.t("ui.session.composer.placeholder")}
        maxLength={draftLimit}
        controls={composer.commands.active()?.controls}
        expanded={composer.commands.active() !== undefined}
        activeDescendant={composer.commands.active()?.activeDescendant()}
        data-slot="session-composer-editor"
        onStateChange={(state) => {
          focused = true
          composer.edit(state.value, state.selection.start, state.agents)
          composer.commands.sync(state)
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!disabled()) focused = false
          composer.commands.close()
        }}
        onPasteFiles={composer.attachments.add}
        onEditor={composer.setEditor}
      />
    </div>
  )
}
