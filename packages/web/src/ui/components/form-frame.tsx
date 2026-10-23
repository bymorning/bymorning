import { createContext, type JSX, type ParentProps, Show, useContext } from "solid-js"

import { type Form } from "../form"
import { Button } from "./button"
import { DialogBody, DialogFooter } from "./dialog"
import "./form-frame.css"

type AnyForm = Pick<Form<any, any>, "pending" | "error" | "submit">
const Context = createContext<{ readonly form: AnyForm; readonly onCancel: (() => void) | undefined }>()

export function FormFrame<R>(props: ParentProps & {
  readonly form: AnyForm
  readonly onCancel?: () => void
  readonly onSuccess?: (value: R) => void
  readonly label?: string
}) {
  const submit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (event) => {
    event.preventDefault()
    void props.form.submit().then((result) => {
      if (result.type !== "success") return
      try { props.onSuccess?.(result.value as R) } catch (cause) {
        // Persistence already succeeded; presentation failure must not invite a retry.
        console.error(cause)
      }
    })
  }
  return <Context.Provider value={{ form: props.form, onCancel: props.onCancel }}><form data-component="form-frame" data-slot="form-frame" aria-label={props.label} aria-busy={props.form.pending} onSubmit={submit}>{props.children}</form></Context.Provider>
}

export function FormFields(props: ParentProps & { readonly paired?: boolean; readonly layout?: "stacked" | "paired" }) {
  return <div data-slot="form-fields" data-layout={props.layout ?? (props.paired ? "paired" : "stacked")}>{props.children}</div>
}

export function FormError() {
  const context = useContext(Context)
  if (!context) throw new Error("FormFrame.Error must be used within FormFrame")
  return <Show when={context.form.error}>{(error) => <p data-slot="form-error" role="alert">{error()}</p>}</Show>
}

export function FormActions(props: {
  readonly submitLabel: string
  readonly pendingLabel?: string
  readonly cancelLabel?: string
  /** Allows retained page forms to add their own admission rule. */
  readonly disabled?: boolean
}) {
  const context = useContext(Context)
  if (!context) throw new Error("FormFrame.Actions must be used within FormFrame")
  return <DialogFooter data-component="form-actions">
    <Button type="button" variant="ghost" size="large" disabled={context.form.pending} onClick={context.onCancel}>{props.cancelLabel ?? "Cancel"}</Button>
    <Button type="submit" variant="primary" size="large" disabled={context.form.pending || props.disabled}>{context.form.pending ? (props.pendingLabel ?? props.submitLabel) : props.submitLabel}</Button>
  </DialogFooter>
}

FormFrame.Fields = FormFields
FormFrame.Error = FormError
FormFrame.Actions = FormActions
