import { For, Show, onCleanup } from "solid-js"
import { useWorkspace } from "@/runtime/workspace.js"
import { useLayout } from "../state/layout.js"
import { MobileDrawer, MobileDrawerTrigger, MobileDrawerContent } from "../mobile-drawer.js"
import { MobilePanel } from "../mobile-panel.js"
import "./titlebar.css"

export function Titlebar() {
  const workspace = useWorkspace()
  const layout = useLayout()
  return (
    <header class="shell-header" data-component="titlebar">
      <a href="/" class="brand" data-slot="brand">
        ByMorning <small>starter</small>
      </a>
      <div class="shell-actions" data-slot="actions">
        <Show when={workspace.state.boot === "ready"}>
          <select
            aria-label="Workspace"
            value={workspace.state.workspace}
            onChange={(event) => {
              layout.close()
              workspace.select(event.currentTarget.value)
            }}
          >
            <For each={workspace.state.workspaces}>{(item) => <option value={item.id}>{item.name}</option>}</For>
          </select>
        </Show>
        <Show when={workspace.state.boot === "ready" && workspace.state.workspace}>
          <MobileDrawer open={layout.state.open} onOpenChange={layout.open} closeOnOutsideFocus={false}>
            <MobileDrawerTrigger class="shell-menu" data-slot="menu-trigger" aria-label="Open sessions">
              Sessions
            </MobileDrawerTrigger>
            <MobileDrawerContent>
              <MobilePanel title="Sessions">
                <NavigationMount />
              </MobilePanel>
            </MobileDrawerContent>
          </MobileDrawer>
        </Show>
      </div>
    </header>
  )
}

function NavigationMount() {
  const layout = useLayout()
  onCleanup(() => layout.mount("mobileMount", undefined))
  return <div ref={(element) => layout.mount("mobileMount", element)} />
}
