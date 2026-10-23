import type { SessionID } from "@bymorning/client/solid"
import { SessionComposer, type SessionUI } from "@bymorning/session-ui"
import { useMutation } from "@tanstack/solid-query"
import { createMemo, createSignal, type Accessor } from "solid-js"
import { useServer } from "@/runtime/server/runtime.js"
import { errorText } from "@/runtime/error.js"

export function Composer(props: {
  readonly sessionID: Accessor<SessionID>
  readonly disabled?: boolean
  readonly agents?: SessionUI.Select
  readonly models?: SessionUI.Select
}) {
  const server = useServer()
  const [draft, setDraft] = createSignal("")
  const prompt = useMutation(() => ({
    mutationFn: (input: { readonly sessionID: SessionID; readonly text: string; readonly draft: string }) =>
      server.data.session.prompt({ sessionID: input.sessionID, text: input.text }),
    onSuccess: (_result, input) => {
      if (props.sessionID() === input.sessionID && draft() === input.draft) setDraft("")
    },
  }))
  const compact = useMutation(() => ({
    mutationFn: (sessionID: SessionID) => server.data.session.compact({ sessionID }),
  }))
  const interrupt = useMutation(() => ({
    mutationFn: (sessionID: SessionID) => server.data.session.interrupt({ sessionID }),
  }))
  const switching = () => props.disabled === true
  const disabled = () => server.state.boot !== "ready" || switching()
  const promptAction: SessionUI.Operation = {
    pending: () => prompt.isPending,
    error: () => (prompt.error ? errorText(prompt.error) : undefined),
    run: () => {
      const value = draft().trim()
      if (value && !disabled() && !prompt.isPending)
        prompt.mutate({ sessionID: props.sessionID(), text: value, draft: draft() })
    },
  }
  const compactAction: SessionUI.Operation = {
    pending: () => compact.isPending,
    error: () => (compact.error ? errorText(compact.error) : undefined),
    run: () => {
      if (!disabled() && !compact.isPending) compact.mutate(props.sessionID())
    },
  }
  const interruptAction: SessionUI.Operation = {
    pending: () => interrupt.isPending,
    error: () => (interrupt.error ? errorText(interrupt.error) : undefined),
    run: () => {
      if (!disabled() && !interrupt.isPending) interrupt.mutate(props.sessionID())
    },
  }
  const active = () => server.data.session.active.get(props.sessionID()) === "running"
  const actionsBusy = createMemo(() => prompt.isPending || compact.isPending || interrupt.isPending)
  const model: SessionUI.ComposerProps = {
    value: draft,
    setValue: setDraft,
    disabled: () => disabled() || actionsBusy(),
    active,
    submit: promptAction,
    compact: compactAction,
    interrupt: interruptAction,
    agents: props.agents,
    models: props.models,
  }
  return <SessionComposer model={model} />
}
