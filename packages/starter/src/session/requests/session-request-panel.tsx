import type { FormAnswer, FormInfo, PermissionReplyInput, PermissionRequest } from "@bymorning/client"
import type { SessionID } from "@bymorning/client/solid"
import { FormView, PermissionView, type SessionUI } from "@bymorning/session-ui"
import { useMutation } from "@tanstack/solid-query"
import { For, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { errorText } from "@/runtime/error.js"
import { useServer } from "@/runtime/server/runtime.js"

export function SessionRequestPanel(props: { readonly sessionID: Accessor<SessionID> }) {
  const server = useServer()
  return (
    <section data-component="requests" aria-label="Pending requests">
      <For each={server.data.session.permission.list(props.sessionID())}>
        {(request) => <Permission sessionID={props.sessionID} request={request} />}
      </For>
      <For each={server.data.session.form.list(props.sessionID())}>
        {(form) => <Form sessionID={props.sessionID} form={form} />}
      </For>
    </section>
  )
}

function Permission(props: { readonly sessionID: Accessor<SessionID>; readonly request: PermissionRequest }) {
  const server = useServer()
  const reply = useMutation(() => ({
    mutationFn: (input: Pick<PermissionReplyInput, "reply" | "message">) =>
      server.data.session.permission.reply({ sessionID: props.sessionID(), requestID: props.request.id, ...input }),
  }))
  const action: SessionUI.Action<Pick<PermissionReplyInput, "reply" | "message">> = {
    pending: () => reply.isPending,
    error: () => (reply.error ? errorText(reply.error) : undefined),
    run: (input) => {
      if (!reply.isPending) reply.mutate(input)
    },
  }
  return (
    <PermissionView
      model={{
        item: () => server.data.session.permission.list(props.sessionID()).find((item) => item.id === props.request.id),
        action,
      }}
    />
  )
}

function Form(props: { readonly sessionID: Accessor<SessionID>; readonly form: FormInfo }) {
  const server = useServer()
  const [answer, setAnswer] = createStore<FormAnswer>(defaults(props.form))
  const reply = useMutation(() => ({
    mutationFn: (value: FormAnswer) =>
      server.data.session.form.reply({ sessionID: props.sessionID(), formID: props.form.id, answer: value }),
  }))
  const cancel = useMutation(() => ({
    mutationFn: () => server.data.session.form.cancel({ sessionID: props.sessionID(), formID: props.form.id }),
  }))
  const submit: SessionUI.Action<FormAnswer> = {
    pending: () => reply.isPending,
    error: () => (reply.error ? errorText(reply.error) : undefined),
    run: (value) => {
      if (!reply.isPending) reply.mutate(value)
    },
  }
  const cancelAction: SessionUI.Operation = {
    pending: () => cancel.isPending,
    error: () => (cancel.error ? errorText(cancel.error) : undefined),
    run: () => {
      if (!cancel.isPending) cancel.mutate()
    },
  }
  return (
    <FormView
      model={{
        item: () => server.data.session.form.list(props.sessionID()).find((item) => item.id === props.form.id),
        answer: () => answer,
        setAnswer: (key, value) =>
          setAnswer((current) => {
            const next = { ...current }
            if (value === undefined) delete next[key]
            else next[key] = value
            return next
          }),
        submit,
        cancel: cancelAction,
      }}
    />
  )
}

function defaults(form: FormInfo): FormAnswer {
  const answer: FormAnswer = {}
  for (const field of form.fields)
    if (field.type !== "external" && field.default !== undefined) answer[field.key] = field.default
  return answer
}
