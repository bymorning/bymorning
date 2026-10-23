import { Show, type JSX } from "solid-js"

import { useComposer } from "./context"
import { stopAndFocus as stop } from "./stop-focus"
import "./stop.css"

export function ComposerStop(): JSX.Element {
  const composer = useComposer()
  return (
    <Show when={composer.command() === "stop" && !composer.blank() && !composer.pending()}>
      <button
        type="button"
        data-component="session-composer-stop"
        disabled={composer.command() === undefined || composer.pending()}
        onClick={() => stop(composer)}
      >
        Stop
      </button>
    </Show>
  )
}
