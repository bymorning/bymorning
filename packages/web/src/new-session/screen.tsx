import { Show, type JSX } from "solid-js"

import { usePrompt } from "../context/prompt"
import { createNewSessionDraftController } from "./controller"
import { NewSessionView } from "./view"

/** Compose the prompt-ready draft workflow inside its resolved Workspace. */
export function NewSessionScreen(props: { readonly draftID: string }): JSX.Element {
  const prompt = usePrompt()
  const controller = createNewSessionDraftController({ draftID: props.draftID })

  return (
    <Show when={prompt.ready()} fallback={<p role="status">Loading prompt...</p>}>
      <NewSessionView controller={controller} />
    </Show>
  )
}
