import { useBeforeLeave } from "@solidjs/router"

import { useDialog } from "../context/dialog"
import { ConfirmDialog } from "../ui/components/confirm-dialog"

/** Asks before in-app navigation discards a form with unsaved changes. Call from a component under the Router. */
export function useLeaveGuard(dirty: () => boolean): void {
  const dialog = useDialog()
  useBeforeLeave((event) => {
    if (event.defaultPrevented || !dirty()) return
    event.preventDefault()
    dialog.show(() => (
      <ConfirmDialog
        title="Discard unsaved changes?"
        description="You have changes that have not been saved. Leaving this page discards them."
        confirmLabel="Discard changes"
        danger
        onConfirm={() => {
          event.retry(true)
        }}
      />
    ))
  })
}
