import { Show } from "solid-js"
import { createStore } from "solid-js/store"

import { useDialog } from "../context/dialog"
import { useI18n } from "../context/i18n"
import { Button } from "./button"
import { Dialog, DialogFooter, DialogHeader, DialogTitle, DialogTitleGroup } from "./dialog"
import { showToast } from "./toast"

export function ConfirmDialog(props: {
  readonly title: string
  readonly description?: string | undefined
  readonly confirmLabel?: string | undefined
  readonly danger?: boolean | undefined
  readonly onConfirm: () => Promise<unknown> | void
}) {
  const dialog = useDialog()
  const i18n = useI18n()
  const [state, setState] = createStore({ pending: false })
  const confirm = () => {
    if (state.pending) return
    // A synchronous onConfirm is already finished; only promises get pending handling.
    const result = props.onConfirm()
    if (!result) {
      dialog.close()
      return
    }
    setState("pending", true)
    void result.then(
      () => dialog.close(),
      (cause: unknown) => {
        setState("pending", false)
        showToast({
          variant: "error",
          title: i18n.t("ui.confirm.failure", { label: props.confirmLabel ?? i18n.t("ui.confirm.confirm") }),
          description: cause instanceof Error ? cause.message : i18n.t("ui.confirm.error"),
        })
      },
    )
  }
  return (
    <Dialog fit data-component="confirm-dialog" aria-label={props.title} aria-busy={state.pending}>
      <DialogHeader hideClose={state.pending}>
        <Show when={props.description} fallback={<DialogTitle>{props.title}</DialogTitle>}>
          {(description) => <DialogTitleGroup title={props.title} description={description()} />}
        </Show>
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="ghost" disabled={state.pending} onClick={() => dialog.close()}>
          {i18n.t("ui.confirm.cancel")}
        </Button>
        <Button type="button" variant={props.danger ? "danger" : "primary"} disabled={state.pending} onClick={confirm}>
          {props.confirmLabel ?? i18n.t("ui.confirm.confirm")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
