import type { SessionInfo } from "@bymorning/client"
import type { Session } from "@bymorning/schema/session"

import { createComponent, type JSX } from "solid-js"

import { ConfirmDialog } from "../ui/components/confirm-dialog"
import { showToast } from "../ui/components/toast"
import type { BmUiI18n } from "../ui/context/i18n"
import { sessionLabel } from "../utils/session-title"

const ARCHIVE_TOAST_MS = 12_000

/** Confirm an archive, with an Undo that restores the Session through the same update operation. */
export function showArchived(input: {
  readonly i18n: BmUiI18n
  readonly session?: Pick<SessionInfo, "title" | "parentID">
  readonly undo: () => Promise<unknown>
}) {
  showToast({
    variant: "success",
    title: input.i18n.t("ui.session.archived"),
    ...(input.session ? { description: sessionLabel(input.session) } : {}),
    // Undo is the only way back, so keep it available well beyond the default.
    duration: ARCHIVE_TOAST_MS,
    actions: [
      {
        label: input.i18n.t("ui.session.undo"),
        onClick: () =>
          void (async () => input.undo())().catch(() =>
            showToast({ variant: "error", title: input.i18n.t("ui.session.unarchiveError") }),
          ),
      },
    ],
  })
}

/**
 * Ask first, then archive a Session, confirm with an Undo toast, and leave it only if the user is still looking at it.
 * Resolves true once archived and false when the user dismisses the confirmation.
 * The mutation may outlive the screen that started it, so everything it needs is passed in.
 */
export function archiveSession(input: {
  readonly i18n: BmUiI18n
  readonly dialog: { show(element: () => JSX.Element, onClose?: () => void): void }
  readonly sessionID: Session.ID
  /** Known Session details, used to name it in the confirmation. */
  readonly session?: Pick<SessionInfo, "title" | "parentID"> | undefined
  readonly update: (patch: { readonly sessionID: Session.ID; readonly archived: boolean }) => Promise<SessionInfo>
  /** Whether the user is still on this Session when the mutation settles. */
  readonly viewing: () => boolean
  readonly leave: () => void
}): Promise<boolean> {
  return new Promise((resolve) => {
    let archived = false
    input.dialog.show(
      () =>
        createComponent(ConfirmDialog, {
          title: "Archive session?",
          description: `“${input.session ? sessionLabel(input.session) : "This session"}” will be hidden from session lists. You can find it under Archived sessions on its project page and restore it.`,
          confirmLabel: "Archive session",
          async onConfirm() {
            const updated = await input.update({ sessionID: input.sessionID, archived: true })
            archived = true
            showArchived({
              i18n: input.i18n,
              session: updated,
              undo: () => input.update({ sessionID: input.sessionID, archived: false }),
            })
            // An archived Session that is still open would otherwise stay on screen with a live composer.
            if (input.viewing()) input.leave()
          },
        }),
      () => resolve(archived),
    )
  })
}
