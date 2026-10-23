import { Show, type JSX } from "solid-js"

import { Icon } from "../../../../ui/components/icon"
import { IconButton } from "../../../../ui/components/icon-button"
import { useComposer } from "./context"
import { stopAndFocus as stop } from "./stop-focus"
import "./submit.css"

export function ComposerSubmit(): JSX.Element {
  const composer = useComposer()
  return (
    <Show
      when={composer.command() === "stop" && (composer.blank() || composer.pending())}
      fallback={
        <IconButton
          type="submit"
          variant="primary"
          icon={<Icon name="arrow-up" />}
          data-slot="session-composer-submit"
          aria-label="Send"
          disabled={composer.command() === undefined || composer.pending() || composer.blank()}
        />
      }
    >
      <IconButton
        type="button"
        variant="primary"
        icon={<Icon name="stop" />}
        data-slot="session-composer-submit"
        aria-label="Stop"
        disabled={composer.pending()}
        onClick={() => stop(composer)}
      />
    </Show>
  )
}
