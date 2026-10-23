import { Show, type JSX } from "solid-js"

import { useComposer } from "./context"
import "./error.css"

export function ComposerError(): JSX.Element {
  const composer = useComposer()
  return (
    <Show when={composer.error()}>
      {(message) => (
        <span data-component="session-composer-error" role="alert">
          {message()}
        </span>
      )}
    </Show>
  )
}
