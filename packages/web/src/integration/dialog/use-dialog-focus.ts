import { createEffect, on } from "solid-js"

import type { IntegrationDialogController } from "./controller"

/** Live element slots the dialog view wires up through ref callbacks. */
export interface DialogFocusRefs {
  backButton?: HTMLButtonElement | undefined
  applicationBack?: HTMLButtonElement | undefined
  keyInput?: HTMLInputElement | undefined
  awsInput?: HTMLInputElement | undefined
  codeInput?: HTMLInputElement | undefined
  doneButton?: HTMLButtonElement | undefined
  applicationInput?: HTMLElement | undefined
  clientForm?: HTMLFormElement | undefined
  applicationStatus?: HTMLParagraphElement | undefined
  selectedAction?: HTMLSpanElement | undefined
  renameRail?: HTMLDivElement | undefined
}

/**
 * Focus choreography across dialog steps: step entry, OAuth client mutation
 * outcomes, and rename rail transitions.
 */
export function useDialogFocus(
  controller: IntegrationDialogController,
  refs: DialogFocusRefs,
  selectedCredential: () => { readonly id: string } | undefined,
) {
  createEffect(() => {
    if (controller.oauthFlow()?.attempt.mode !== "code") return
    queueMicrotask(() => refs.codeInput?.focus({ preventScroll: true }))
  })
  createEffect(() => {
    if (controller.store.view !== "oauth-client" || !controller.store.clientMessage) return
    const mutation = controller.clientMutation()
    if (mutation.state === "commit-unknown" && !controller.clientMethodAvailable()) return
    queueMicrotask(() => refs.applicationStatus?.focus({ preventScroll: true }))
  })
  createEffect(() => {
    const mutation = controller.clientMutation()
    if (mutation.state === "idle" || mutation.state === "loading") return
    if (mutation.state === "success" && mutation.operation.kind === "delete") {
      queueMicrotask(() => refs.backButton?.focus({ preventScroll: true }))
      return
    }
    if (mutation.state === "commit-unknown" && !controller.clientMethodAvailable()) return
    queueMicrotask(() => refs.applicationStatus?.focus({ preventScroll: true }))
  })
  createEffect(() => {
    const mutation = controller.clientMutation()
    if (
      mutation.state !== "commit-unknown" ||
      controller.store.view !== "oauth-client" ||
      controller.clientMethodAvailable()
    )
      return
    queueMicrotask(() => (refs.applicationBack ?? refs.backButton)?.focus({ preventScroll: true }))
  })
  createEffect(
    on(
      () => controller.store.view,
      () => {
        queueMicrotask(() => {
          const view = controller.store.view
          if (view === "picker") return
          if (view === "key") return refs.keyInput?.focus({ preventScroll: true })
          if (view === "aws-sigv4") return refs.awsInput?.focus({ preventScroll: true })
          if (view === "oauth-client") {
            return (
              refs.applicationInput ??
              refs.clientForm?.querySelector<HTMLElement>('input, select, textarea, [role="checkbox"], [role="combobox"]')
            )?.focus({ preventScroll: true })
          }
          if (view === "oauth" && controller.flow().state === "oauth") {
            return refs.codeInput?.focus({ preventScroll: true })
          }
          if (view === "success") return refs.doneButton?.focus({ preventScroll: true })
          refs.backButton?.focus({ preventScroll: true })
        })
      },
    ),
  )
  createEffect(
    on(
      () => controller.store.renameID,
      (renameID, previousRenameID) => {
        if (controller.store.view !== "connection" || selectedCredential()?.id !== (renameID ?? previousRenameID))
          return
        if (renameID !== undefined) {
          refs.renameRail?.querySelector<HTMLElement>("[autofocus]")?.focus({ preventScroll: true })
          return
        }
        if (previousRenameID === undefined) return
        refs.selectedAction?.querySelector<HTMLElement>('[data-slot="action-menu-trigger"]')?.focus({
          preventScroll: true,
        })
      },
    ),
  )
}
