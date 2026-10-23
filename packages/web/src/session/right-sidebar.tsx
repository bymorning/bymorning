import { createEffect, on, onCleanup, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { Icon } from "../ui/components/icon"
import { IconButton } from "../ui/components/icon-button"
import { ResizeHandle } from "../ui/components/resize-handle"
import "./right-sidebar.css"

export namespace RightSidebar {
  export interface Size {
    readonly width: () => number
    readonly min: number
    readonly max: () => number
    readonly full: () => number
    readonly resize: (width: number) => void
    readonly reset: () => void
  }

  export interface Props {
    readonly open: boolean
    readonly size: Size
    readonly close: () => void
    readonly restoreFocus: () => void
    /**
     * Consulted as the panel opens. The opening control is hidden while open, which drops its focus, so
     * when this returns true the panel's close button takes focus instead.
     */
    readonly focusOnOpen?: () => boolean
    readonly header?: JSX.Element
    readonly children: JSX.Element
  }
}

export function RightSidebar(props: RightSidebar.Props): JSX.Element {
  const [state, setState] = createStore({ resizing: false, restore: false, animating: false, expanded: false })
  let panel!: HTMLElement
  let closeButton: HTMLButtonElement | undefined

  onMount(() => {
    const stop = () => setState("resizing", false)
    window.addEventListener("pointerup", stop)
    window.addEventListener("pointercancel", stop)
    window.addEventListener("mouseup", stop)
    window.addEventListener("blur", stop)
    onCleanup(() => {
      window.removeEventListener("pointerup", stop)
      window.removeEventListener("pointercancel", stop)
      window.removeEventListener("mouseup", stop)
      window.removeEventListener("blur", stop)
    })
  })

  createEffect(
    on(
      () => props.open,
      (open) => {
        setState("animating", true)
        if (open) {
          if (props.focusOnOpen?.()) {
            queueMicrotask(() => {
              if (props.open) closeButton?.focus({ preventScroll: true })
            })
          }
        }
        if (!open && (state.restore || panel.contains(document.activeElement))) {
          setState("restore", false)
          queueMicrotask(() => {
            if (!props.open) props.restoreFocus()
          })
        }
      },
      { defer: true },
    ),
  )
  onCleanup(() => {
    if (panel.contains(document.activeElement)) queueMicrotask(props.restoreFocus)
  })

  return (
    <div
      data-slot="right-sidebar-shell"
      data-open={props.open ? "" : undefined}
      data-expanded={state.expanded ? "" : undefined}
    >
      <aside
        ref={(element) => (panel = element)}
        data-component="right-sidebar"
        data-open={props.open ? "" : undefined}
        data-expanded={state.expanded ? "" : undefined}
        data-resizing={state.resizing ? "" : undefined}
        data-animating={state.animating ? "" : undefined}
        onTransitionEnd={(event) => {
          if (event.target === panel && event.propertyName === "width") setState("animating", false)
        }}
        aria-label="Right sidebar"
        aria-hidden={props.open ? undefined : "true"}
        inert={!props.open}
        onFocusIn={() => setState("restore", true)}
        onFocusOut={(event) => {
          if (props.open && !(event.relatedTarget instanceof Node && panel.contains(event.relatedTarget))) {
            setState("restore", false)
          }
        }}
        style={{ "--right-sidebar-width": `${state.expanded ? props.size.full() : props.size.width()}px` }}
      >
        <div data-slot="right-sidebar-resize" onPointerDown={() => setState("resizing", true)}>
          <ResizeHandle
            direction="horizontal"
            edge="start"
            size={props.size.width()}
            min={props.size.min}
            max={props.size.max()}
            onResize={props.size.resize}
            onDblClick={props.size.reset}
          />
        </div>
        <header data-slot="right-sidebar-header">
          <div data-slot="right-sidebar-action">{props.header}</div>
          <div data-slot="right-sidebar-controls">
            <IconButton
              type="button"
              size="large"
              variant="ghost-muted"
              state={state.expanded ? "pressed" : "rest"}
              data-slot="right-sidebar-expand"
              aria-label={state.expanded ? "Collapse right sidebar" : "Expand right sidebar"}
              aria-pressed={state.expanded}
              onClick={() => setState({ expanded: !state.expanded, animating: true })}
              icon={<Icon name={state.expanded ? "collapse" : "expand"} />}
            />
            <IconButton
              ref={(element: HTMLButtonElement) => (closeButton = element)}
              type="button"
              size="large"
              variant="ghost-muted"
              state="pressed"
              aria-label="Close right sidebar"
              title="Close right sidebar"
              onClick={() => {
                setState("restore", true)
                props.close()
              }}
              icon={<Icon name="sidebar-right" />}
            />
          </div>
        </header>
        <div data-slot="right-sidebar-content">{props.children}</div>
      </aside>
    </div>
  )
}
