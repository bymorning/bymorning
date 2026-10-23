import { Show } from "solid-js"

import { useEntry } from "../../context/dialog"
import { createForm } from "../form"
import { Button } from "./button"
import { Dialog, DialogFooter, DialogHeader, DialogTitle, DialogTitleGroup } from "./dialog"

export function ConfirmDialog(props: {
  readonly title: string
  readonly description?: string | undefined
  readonly confirmLabel?: string | undefined
  readonly danger?: boolean | undefined
  readonly onConfirm: () => Promise<unknown> | void
}) {
  const entry = useEntry()
  const form = createForm({
    values: {},
    submit: () => props.onConfirm(),
    fallback: "Something went wrong.",
  })
  entry.guard(() => form.pending)
  const confirm = () => {
    void form.submit().then((result) => {
      if (result.type === "success") entry.close()
    })
  }
  return (
    <Dialog fit variant="card" data-component="confirm-dialog" aria-label={props.title} aria-busy={form.pending}>
      <DialogHeader hideClose={form.pending}>
        <Show when={props.description} fallback={<DialogTitle>{props.title}</DialogTitle>}>
          {(description) => <DialogTitleGroup title={props.title} description={description()} />}
        </Show>
      </DialogHeader>
      <Show when={form.error}>
        {(message) => (
          <p role="alert" data-slot="confirm-error">
            {message()}
          </p>
        )}
      </Show>
      <DialogFooter>
        <Button type="button" variant="ghost" size="large" disabled={form.pending} onClick={() => entry.dismiss()}>
          Cancel
        </Button>
        <Button
          type="button"
          variant={props.danger ? "danger" : "primary"}
          size="large"
          disabled={form.pending}
          onClick={confirm}
        >
          {props.confirmLabel ?? "Confirm"}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
