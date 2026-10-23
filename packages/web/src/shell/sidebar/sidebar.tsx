import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { Icon } from "../../ui/components/icon"
import { IconButton } from "../../ui/components/icon-button"
import { ResizeHandle } from "../../ui/components/resize-handle"
import { SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN, useLayout } from "../state/layout"
import "./sidebar.css"

export namespace Sidebar {
  export interface Slots {
    readonly mobileToggle: JSX.Element
    readonly frame: JSX.Element
  }

  export interface Props {
    readonly children: (onDismiss: () => void) => JSX.Element
    readonly render: (slots: Slots) => JSX.Element
  }
}

export function Sidebar(props: Sidebar.Props): JSX.Element {
  const layout = useLayout()
  const [mobile, setMobile] = createStore({ matches: false, open: false })
  const [resizing, setResizing] = createSignal(false)
  const opened = () => (mobile.matches ? mobile.open : layout.sidebar.opened())
  const dismiss = () => {
    if (mobile.matches) setMobile("open", false)
  }
  const toggleMobile = () => setMobile("open", (value) => !value)

  onMount(() => {
    const query = window.matchMedia("(max-width: 700px)")
    const change = (event: MediaQueryListEvent | MediaQueryList) => {
      setMobile("matches", event.matches)
      if (!event.matches) setMobile("open", false)
    }
    change(query)
    query.addEventListener("change", change)
    const stopResizing = () => setResizing(false)
    window.addEventListener("mouseup", stopResizing)
    window.addEventListener("blur", stopResizing)
    onCleanup(() => {
      query.removeEventListener("change", change)
      window.removeEventListener("mouseup", stopResizing)
      window.removeEventListener("blur", stopResizing)
    })
  })

  return props.render({
    mobileToggle: (
      <IconButton
        type="button"
        size="large"
        variant="ghost-muted"
        data-slot="mobile-sidebar-toggle"
        aria-label={mobile.open ? "Close project sidebar" : "Open project sidebar"}
        aria-controls="project-sidebar"
        aria-expanded={mobile.open}
        onClick={toggleMobile}
        icon={<Icon name="sidebar-left" />}
      />
    ),
    frame: (
      <>
        <Show when={mobile.matches && mobile.open}>
          <button
            type="button"
            data-slot="mobile-sidebar-backdrop"
            aria-label="Close project sidebar"
            onClick={dismiss}
          />
        </Show>
        <aside
          id="project-sidebar"
          data-slot="project-sidebar"
          data-open={opened() ? "" : undefined}
          data-resizing={resizing() ? "" : undefined}
          aria-hidden={!opened()}
          inert={!opened()}
          style={`--project-sidebar-width: ${layout.sidebar.width()}px`}
        >
          {props.children(dismiss)}
        </aside>
        <div
          data-slot="project-sidebar-resize"
          data-open={layout.sidebar.opened() ? "" : undefined}
          onPointerDown={() => setResizing(true)}
          style={`--project-sidebar-width: ${layout.sidebar.width()}px`}
        >
          <ResizeHandle
            direction="horizontal"
            size={layout.sidebar.opened() ? layout.sidebar.width() : 0}
            min={0}
            max={SIDEBAR_WIDTH_MAX}
            onResize={(width) => {
              if (width < 120) {
                const restoreFocus = document.getElementById("project-sidebar")?.contains(document.activeElement)
                layout.sidebar.close()
                if (restoreFocus)
                  queueMicrotask(() =>
                    document.querySelector<HTMLElement>('[data-slot="shell-content"]')?.focus({ preventScroll: true }),
                  )
                return
              }
              layout.sidebar.resize(Math.max(SIDEBAR_WIDTH_MIN, width))
              layout.sidebar.open()
            }}
            onDblClick={() => {
              layout.sidebar.resize(SIDEBAR_WIDTH_DEFAULT)
              layout.sidebar.open()
            }}
          />
        </div>
      </>
    ),
  })
}
