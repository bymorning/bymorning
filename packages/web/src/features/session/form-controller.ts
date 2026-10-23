import type { FormInfo } from "@bymorning/client"
import { Form } from "@bymorning/schema/form"
import { createStore, reconcile } from "solid-js/store"
import type { Controller as SessionController } from "./session-controller"
import type { SessionForm } from "./ui/session-form"
import { formNavigation } from "./form-navigation"
import { projectFormItem } from "./form-presenter"
import type { FormViewModel } from "./ui/form-model"

type Source = {
  readonly data: Pick<SessionController["data"], "forms">
  readonly form: SessionController["form"]
}

export function createController(source: Source): SessionForm.Model {
  const item = () => source.data.forms()[0]
  const [state, setState] = createStore<{
    identity: string | undefined
    revision: number
    answers: Record<string, Form.Value | undefined>
    validation: string | undefined
    view: FormViewModel | undefined
  }>({
    identity: undefined,
    revision: 0,
    answers: {},
    validation: undefined,
    view: undefined,
  })
  const sync = () => {
    const current = item()
    const identity = current === undefined ? undefined : JSON.stringify([current.id, current.fields])
    if (identity === state.identity) return current
    setState(
      reconcile({
        identity,
        revision: state.revision + 1,
        answers: current === undefined ? {} : Form.defaults(current.fields),
        validation: undefined,
        view: current === undefined ? undefined : projectFormItem(current),
      }),
    )
    return current
  }
  const run = async (operation: (form: FormInfo) => Promise<void>) => {
    const current = sync()
    if (current === undefined || source.form.pendingAction(current) !== undefined) return
    setState("validation", undefined)
    try {
      await operation(current)
    } catch {
      /* The native mutation owns the failure. */
    }
  }
  return {
    item: () => {
      sync()
      return state.view
    },
    lifecycle: () => (sync() === undefined ? undefined : state.revision),
    answers: () => {
      sync()
      return state.answers
    },
    set: (key, value) => {
      const current = sync()
      if (!current?.fields.some((field) => field.key === key)) return
      setState("answers", key, value)
    },
    pendingAction: () => {
      const current = sync()
      return current === undefined ? undefined : source.form.pendingAction(current)
    },
    error: () => {
      const current = sync()
      return state.validation ?? (current === undefined ? undefined : source.form.error(current))
    },
    submit: () => run((form) => source.form.reply(form, Form.normalize(form.fields, state.answers), "submit")),
    back: () =>
      run(async (form) => {
        const navigation = formNavigation(form)
        if (navigation === undefined) {
          setState("validation", "This form does not support back navigation.")
          return
        }
        await source.form.reply(form, { [navigation.actionKey]: navigation.backValue }, "back")
      }),
    cancel: () => run(source.form.cancel),
  }
}

export type Controller = ReturnType<typeof createController>
