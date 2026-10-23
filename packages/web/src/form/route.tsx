import type { FormInfo } from "@bymorning/client"
import { useMutation } from "@tanstack/solid-query"
import type { Workspace } from "@bymorning/schema/workspace"
import { Form } from "@bymorning/schema/form"
import { Schema } from "effect"
import { A, useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, For, onCleanup, Show, type JSX } from "solid-js"
import { createStore, unwrap } from "solid-js/store"

import { useSDK } from "../context/sdk"
import { useWorkspace } from "../context/workspace"
import { projectFormItem } from "../features/session/form-presenter"
import { FormView } from "../features/session/ui/form-view"
import type { FormFieldValue, FormViewModel } from "../features/session/ui/form-model"
import { errorMessage } from "../utils/error-message"
import "./route.css"

type Reply = { readonly workspace: Workspace.ID; readonly formID: Form.ID; readonly generation: number } & (
  { readonly action: "submit"; readonly answer: Form.Answer } | { readonly action: "cancel" }
)

/** Authenticated caller-bound Forms. These Forms have no conversation Session and settle only on an explicit reply. */
export function FormRoute(): JSX.Element {
  const { client } = useSDK()
  const workspace = useWorkspace()
  const params = useParams<{ formID?: string }>()
  const navigate = useNavigate()
  const [state, setState] = createStore({
    forms: [] as ReadonlyArray<FormInfo>,
    current: undefined as FormInfo | undefined,
    answers: {} as Record<string, FormFieldValue | undefined>,
    error: undefined as string | undefined,
    loading: true,
  })
  const query = () => ({ workspace: workspace.current().id })
  let disposed = false
  let admitted: number | undefined
  let generation = 0
  onCleanup(() => {
    disposed = true
  })
  const reply = useMutation(() => ({
    retry: false,
    networkMode: "always",
    mutationFn: async (input: Reply) => {
      if (input.action === "submit")
        await client.form.caller.reply({ workspace: input.workspace, formID: input.formID, answer: input.answer })
      else await client.form.caller.cancel({ workspace: input.workspace, formID: input.formID })
    },
  }))
  const relevant = () =>
    reply.variables?.formID === formID() &&
    reply.variables?.workspace === workspace.current().id &&
    reply.variables?.generation === generation
  const formID = createMemo(() =>
    params.formID === undefined
      ? undefined
      : Schema.decodeUnknownOption(Form.ID)(params.formID).pipe((option) =>
          option._tag === "Some" ? option.value : undefined,
        ),
  )

  createEffect(() => {
    const id = formID()
    generation++
    const controller = new AbortController()
    setState({ loading: true, error: undefined, current: undefined, answers: {} })
    void (
      id === undefined
        ? client.form.caller.list(query(), { signal: controller.signal })
        : client.form.caller.get({ ...query(), formID: id }, { signal: controller.signal }).then((form) => [form])
    )
      .then((forms) => {
        if (controller.signal.aborted) return
        const current = id === undefined ? undefined : forms[0]
        setState({ forms, current, answers: current ? Form.defaults(current.fields) : {}, loading: false })
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setState({ loading: false, error: errorMessage(cause, "Form is unavailable.") })
      })
    onCleanup(() => controller.abort())
  })

  const view = createMemo<FormViewModel | undefined>(() => {
    const form = state.current
    if (!form) return undefined
    return projectFormItem(form)
  })
  // Caller-bound Forms have no Session event feed. Polling this read-only state endpoint makes a
  // concurrently settled Form disappear without introducing a synthetic Session or retrying a write.
  createEffect(() => {
    const form = state.current
    if (!form) return
    const scope = query()
    let active = true
    const timer = window.setInterval(() => {
      void client.form.caller
        .state({ ...scope, formID: form.id })
        .then((current) => {
          if (
            active &&
            formID() === form.id &&
            workspace.current().id === scope.workspace &&
            current.status !== "pending"
          )
            void navigate(`/w/${scope.workspace}/form`)
        })
        .catch(() => undefined)
    }, 2_000)
    onCleanup(() => {
      active = false
      window.clearInterval(timer)
    })
  })
  const settle = async (action: "submit" | "cancel") => {
    const form = state.current
    if (!form || admitted === generation || (relevant() && reply.isPending)) return
    const scope = query()
    const target = { ...scope, formID: form.id, generation }
    const input: Reply =
      action === "submit"
        ? { ...target, action, answer: Form.normalize(form.fields, structuredClone(unwrap(state.answers))) }
        : { ...target, action }
    admitted = generation
    try {
      await reply.mutateAsync(input)
      if (
        !disposed &&
        generation === input.generation &&
        formID() === form.id &&
        workspace.current().id === scope.workspace
      )
        void navigate(`/w/${scope.workspace}/form`)
    } catch {
      // The native mutation retains the transport failure.
    } finally {
      if (admitted === input.generation) admitted = undefined
    }
  }

  return (
    <main data-component="caller-form-route">
      <Show when={!state.loading} fallback={<p role="status">Loading form…</p>}>
        <Show when={view()} fallback={<FormList forms={state.forms} error={state.error} />}>
          {(item) => (
            <FormView
              item={item()}
              answers={state.answers}
              set={(key, value) => setState("answers", key, value)}
              pendingAction={relevant() && reply.isPending ? reply.variables?.action : undefined}
              error={
                relevant() && reply.error ? errorMessage(reply.error, "Form response failed. Try again.") : state.error
              }
              onSubmit={() => void settle("submit")}
              onCancel={() => void settle("cancel")}
            />
          )}
        </Show>
      </Show>
    </main>
  )
}

function FormList(props: { readonly forms: ReadonlyArray<FormInfo>; readonly error: string | undefined }): JSX.Element {
  return (
    <section aria-labelledby="forms-title">
      <h1 id="forms-title">Forms</h1>
      <Show when={props.error}>{(error) => <p role="alert">{error()}</p>}</Show>
      <Show when={props.forms.length > 0} fallback={<p>No forms need your response.</p>}>
        <ul>
          <For each={props.forms}>
            {(form) => (
              <li>
                <A href={`./form/${encodeURIComponent(form.id)}`}>{form.title}</A>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  )
}
