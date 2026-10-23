import type { ParentProps } from "solid-js"
import { MobileDrawerClose, MobileDrawerLabel } from "./mobile-drawer.js"
import "./mobile-panel.css"

export function MobilePanel(props: ParentProps<{ title: string }>) {
  return (
    <div data-slot="mobile-panel" data-corvu-no-drag>
      <div data-slot="mobile-panel-header">
        <MobileDrawerLabel>{props.title}</MobileDrawerLabel>
        <MobileDrawerClose data-slot="mobile-panel-close" aria-label={`Close ${props.title.toLowerCase()}`}>
          Close
        </MobileDrawerClose>
      </div>
      <div data-slot="mobile-panel-content">{props.children}</div>
    </div>
  )
}
