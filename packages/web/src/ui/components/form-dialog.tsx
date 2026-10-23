import { type JSX, type ParentProps, Show } from "solid-js"

import { useEntry, type DialogEntry } from "../../context/dialog"
import { type Form } from "../form"
import { Dialog, DialogBody, DialogHeader, DialogTitle, DialogTitleGroup } from "./dialog"
import { FormFrame } from "./form-frame"
import "./form-dialog.css"

type AnyForm = Pick<Form<any, any>, "pending" | "error" | "submit">

export function FormDialog<V extends object, R>(
  props: ParentProps & {
    readonly form: Form<V, R>
    readonly title: string
    readonly description?: JSX.Element
    readonly size?: "normal" | "large" | "x-large" | "full"
    readonly actions: JSX.Element
    readonly onSuccess?: (value: R, entry: DialogEntry) => void
    /** Runs instead of dismissing the dialog when Cancel is chosen. */
    readonly onCancel?: () => void
  },
) {
  const entry = useEntry()
  entry.guard(() => props.form.pending)
  const success = (value: R) => {
    if (!entry.active) return
    try {
      if (props.onSuccess) props.onSuccess(value, entry)
      else entry.close()
    } catch (cause) {
      // A post-success presentation callback cannot turn a persisted success into failure.
      console.error(cause)
    }
  }
  return (
    <Dialog
      fit
      variant="card"
      data-component="form-dialog"
      {...(props.size ? { size: props.size } : {})}
      aria-label={props.title}
      aria-busy={props.form.pending}
    >
      <FormFrame
        form={props.form}
        onCancel={() => (props.onCancel ? props.onCancel() : entry.dismiss())}
        onSuccess={success}
      >
        <DialogHeader hideClose={props.form.pending}>
          <Show when={props.description} fallback={<DialogTitle>{props.title}</DialogTitle>}>
            {(description) => <DialogTitleGroup title={props.title} description={description()} />}
          </Show>
        </DialogHeader>
        <DialogBody>
          <div data-slot="form-dialog-body">{props.children}</div>
        </DialogBody>
        <FormFrame.Error />
        {props.actions}
      </FormFrame>
    </Dialog>
  )
}
