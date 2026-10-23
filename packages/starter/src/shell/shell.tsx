import { ResizeHandle } from "@bymorning/ui/resize-handle"
import { Toast } from "@bymorning/ui/toast"
import { Show, Suspense, onCleanup, type ParentProps } from "solid-js"
import { useWorkspace } from "@/runtime/workspace.js"
import { useLayout } from "./state/layout.js"
import { Titlebar } from "./titlebar/titlebar.js"
import "./shell.css"

export function Shell(props: ParentProps) {
  const layout = useLayout()
  const workspace = useWorkspace()
  return (
    <div
      class="shell"
      data-starter
      data-component="shell"
      data-mobile-open={layout.state.open}
      style={{ "--session-rail-width": `${layout.state.width}px` }}
    >
      <Titlebar />
      <div data-slot="body">
        <Show when={!layout.state.mobile && workspace.state.boot === "ready" && workspace.state.workspace}>
          <aside class="shell-rail" data-slot="rail">
            <div
              ref={(element) => {
                layout.mount("desktopMount", element)
                onCleanup(() => layout.mount("desktopMount", undefined))
              }}
            />
            <ResizeHandle
              direction="horizontal"
              size={layout.state.width}
              min={140}
              max={520}
              onResize={layout.resize}
            />
          </aside>
        </Show>
        <main class="shell-content" data-slot="content">
          <Suspense>{props.children}</Suspense>
        </main>
      </div>
      <Toast.Region />
    </div>
  )
}
