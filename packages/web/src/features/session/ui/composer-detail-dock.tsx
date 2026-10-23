import type { JSX } from "solid-js"

import "./composer-detail-dock.css"

/** Drawer that tucks beneath a Composer to hold its contextual detail controls. */
export function ComposerDetailDock(props: { readonly children: JSX.Element }): JSX.Element {
  return <div data-component="composer-detail-dock">{props.children}</div>
}
