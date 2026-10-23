import type { JSX, ParentProps } from "solid-js"

import { useI18n } from "../../../../ui/context/i18n"
import { useComposer } from "./context"
import { draftLimit } from "./input"

export function ComposerFrame(props: ParentProps): JSX.Element {
  const composer = useComposer()
  const language = useI18n()
  const disabled = () => composer.command() === undefined || composer.pending()
  const onSubmit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (event) => {
    event.preventDefault()
    if (disabled() || composer.blank() || composer.value().length > draftLimit) return
    void composer.submit()
  }
  return (
    <form
      data-component="session-composer"
      aria-label={language.t("ui.session.composer.prompt")}
      aria-busy={composer.pending()}
      onDragOver={(event) => {
        const transfer = event.dataTransfer
        if (transfer?.types.includes("Files")) event.preventDefault()
      }}
      onDrop={(event) => {
        const transfer = event.dataTransfer
        if (!transfer || transfer.files.length === 0) return
        event.preventDefault()
        composer.attachments.add(transfer.files)
      }}
      onSubmit={onSubmit}
    >
      {props.children}
    </form>
  )
}
