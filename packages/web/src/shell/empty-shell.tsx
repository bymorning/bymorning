import type { JSX } from "solid-js"

import "./shell.css"
import "./sidebar/sidebar.css"

/** Application chrome with empty sidebar and content while the workspace is pending. */
export function EmptyShell(): JSX.Element {
  return (
    <div data-component="shell" data-layout="contained" aria-busy="true">
      <div data-slot="shell-body">
        <aside data-slot="project-sidebar" data-open="" style="--project-sidebar-width: 256px" />
        <main data-slot="shell-content" tabIndex={-1} />
      </div>
    </div>
  )
}
