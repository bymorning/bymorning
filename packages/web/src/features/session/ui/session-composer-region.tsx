import { createEffect, on, type JSX } from "solid-js"

import { ComposerDetailDock } from "./composer-detail-dock"
import { Composer, type ComposerModel } from "./session-composer"
import { SessionPermission } from "./session-permission"
import { SessionForm } from "./session-form"
import "./session-composer-region.css"

export function NewSessionComposerRegion(props: {
  readonly composer: ComposerModel
  readonly children: JSX.Element
}): JSX.Element {
  return (
    <div data-component="session-composer-region" data-variant="new-session">
      <div data-slot="session-composer-region-composer">
        <Composer model={props.composer} autofocus />
      </div>
      <div data-slot="session-composer-region-detail">
        <ComposerDetailDock>{props.children}</ComposerDetailDock>
      </div>
    </div>
  )
}

export function SessionComposerRegion(props: {
  readonly composer: ComposerModel
  readonly permission: SessionPermission.Model
  readonly form?: SessionForm.Model
  readonly autofocus?: boolean
}): JSX.Element {
  let permissionRegion: HTMLDivElement | undefined
  let composerRegion: HTMLDivElement | undefined
  let permissionPrimary: HTMLButtonElement | undefined
  let formPrimary: HTMLElement | undefined
  let engaged = false

  createEffect(
    on(
      () => props.permission.item()?.id ?? props.form?.lifecycle(),
      (id, previous) => {
        const composerHadFocus = composerRegion?.contains(document.activeElement) === true
        const permissionHadFocus = permissionRegion?.contains(document.activeElement) === true
        if (id !== undefined && (composerHadFocus || permissionHadFocus || (previous !== undefined && engaged))) {
          engaged = true
          queueMicrotask(() => (props.permission.item() ? permissionPrimary : formPrimary)?.focus())
        }
        if (id === undefined && previous !== undefined && engaged) queueMicrotask(props.composer.restoreFocus)
      },
    ),
  )

  return (
    <div data-component="session-composer-region">
      <div
        ref={(node) => (permissionRegion = node)}
        data-slot="session-composer-region-permission"
        onClick={() => (engaged = true)}
      >
        <SessionPermission model={props.permission} primary={(node) => (permissionPrimary = node)} />
      </div>
      {props.form ? (
        <div data-slot="session-composer-region-form" hidden={props.permission.item() !== undefined}>
          <SessionForm model={props.form} primary={(node) => (formPrimary = node)} />
        </div>
      ) : null}
      <div
        ref={(node) => (composerRegion = node)}
        data-slot="session-composer-region-composer"
        hidden={props.permission.item() !== undefined || props.form?.item() !== undefined}
      >
        <Composer model={props.composer} autofocus={props.autofocus === true} />
      </div>
    </div>
  )
}
