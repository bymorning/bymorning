import { For, Show, type JSX } from "solid-js"

import { Icon } from "../../ui/components/icon"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../../ui/sidebar/sidebar"
import { consoleSidebar, type ProjectSidebarPane, type ConsoleSidebarItemID, type WorkspaceRouteID } from "./navigation"
import "./view.css"

const isMac = () => typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

export function ProjectSidebarView(props: {
  readonly footer?: JSX.Element
  readonly pane: ProjectSidebarPane
  readonly transition?: "forward" | "backward" | undefined
  readonly gatewayCurrentItem?: ConsoleSidebarItemID | undefined
  readonly canCreateSession: boolean
  readonly createDisabled?: string | undefined
  readonly searchLabel?: string | undefined
  readonly projects?: JSX.Element
  readonly onCreateSession: () => void
  readonly routes?:
    | ReadonlyArray<{
        readonly id: WorkspaceRouteID
        readonly label: string
        readonly icon: Parameters<typeof Icon>[0]["name"]
        readonly active: boolean
        readonly onSelect: () => void
      }>
    | undefined
  readonly onOpenSearch?: (() => void) | undefined
  readonly onTransitionEnd: () => void
  readonly returnToMain: () => void
  readonly onReturnToMain?: (() => void) | undefined
  readonly selectGatewayItem: (item: ConsoleSidebarItemID) => void
}): JSX.Element {
  let sidebar: HTMLElement | undefined
  const overview = () => props.routes?.find((route) => route.id === "overview")
  const scheduledTasks = () => props.routes?.find((route) => route.id === "scheduledTasks")
  const workspaceRoutes = () =>
    props.routes?.filter((route) => route.id !== "overview" && route.id !== "scheduledTasks")

  return (
    <Sidebar
      ref={sidebar}
      data-project-sidebar=""
      data-pane-transition={props.transition}
      aria-label="Workspace navigation"
      onAnimationEnd={(event) => {
        const slot = (event.target as HTMLElement).dataset.slot
        if (slot === "project-sidebar-main" || slot === "project-sidebar-nested") props.onTransitionEnd()
      }}
      onAnimationCancel={(event) => {
        const slot = (event.target as HTMLElement).dataset.slot
        if (slot === "project-sidebar-main" || slot === "project-sidebar-nested") props.onTransitionEnd()
      }}
    >
      <SidebarContent>
        <div
          data-slot="project-sidebar-main"
          data-visible={props.pane === "main" ? "" : undefined}
          aria-hidden={props.pane !== "main"}
          inert={props.pane !== "main"}
        >
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                data-kind="new-session"
                disabled={!props.canCreateSession}
                title={props.createDisabled}
                aria-description={props.createDisabled}
                onClick={props.onCreateSession}
              >
                <Icon name="central-plus-small" />
                <span data-slot="project-sidebar-menu-label">New Session</span>
                <kbd aria-hidden="true">{isMac() ? "⇧⌘O" : "⌃⇧O"}</kbd>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <Show when={props.onOpenSearch}>
            {(onOpenSearch) => (
              <button
                type="button"
                data-slot="project-sidebar-search"
                aria-keyshortcuts="F"
                onClick={() => onOpenSearch()()}
              >
                <Icon name="central-search" />
                <span data-slot="project-sidebar-search-label">{props.searchLabel ?? "Find"}</span>
                <kbd aria-hidden="true">F</kbd>
              </button>
            )}
          </Show>
          <SidebarMenu>
            <Show when={overview()}>
              {(route) => (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    aria-current={route().active ? "page" : undefined}
                    data-active={route().active ? "" : undefined}
                    onClick={route().onSelect}
                  >
                    <span data-slot="project-sidebar-nav-icon">
                      <Icon name={route().icon} />
                    </span>
                    <span data-slot="project-sidebar-menu-label">{route().label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </Show>
            <Show when={scheduledTasks()}>
              {(route) => (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    aria-current={route().active ? "page" : undefined}
                    data-active={route().active ? "" : undefined}
                    onClick={route().onSelect}
                  >
                    <span data-slot="project-sidebar-nav-icon">
                      <Icon name={route().icon} />
                    </span>
                    <span data-slot="project-sidebar-menu-label">{route().label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </Show>
            <Show when={props.projects}>{(projects) => projects()}</Show>
            <For each={workspaceRoutes()}>
              {(route) => (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    aria-current={route.active ? "page" : undefined}
                    data-active={route.active ? "" : undefined}
                    onClick={route.onSelect}
                  >
                    <span data-slot="project-sidebar-nav-icon">
                      <Icon name={route.icon} />
                    </span>
                    <span data-slot="project-sidebar-menu-label">{route.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </For>
          </SidebarMenu>
        </div>
        <div
          data-slot="project-sidebar-nested"
          data-product-pane="gateway"
          data-visible={props.pane === "console" ? "" : undefined}
          aria-hidden={props.pane !== "console"}
          inert={props.pane !== "console"}
        >
          <button
            type="button"
            data-slot="project-sidebar-back"
            aria-label={`Back to main navigation from ${consoleSidebar.label}`}
            onClick={() => {
              props.returnToMain()
              props.onReturnToMain?.()
              queueMicrotask(() => sidebar?.querySelector<HTMLButtonElement>('[data-kind="new-session"]')?.focus())
            }}
          >
            <Icon name="central-arrow-left" />
            <span>{consoleSidebar.label}</span>
          </button>
          <SidebarMenu>
            <For each={consoleSidebar.groups}>
              {(group) => (
                <>
                  <li data-slot="project-sidebar-group-label" aria-hidden="true">
                    {group.label}
                  </li>
                  <For each={group.items}>
                    {(item) => (
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          aria-current={props.gatewayCurrentItem === item.id ? "page" : undefined}
                          data-active={props.gatewayCurrentItem === item.id ? "" : undefined}
                          onClick={() => props.selectGatewayItem(item.id)}
                        >
                          <span data-slot="project-sidebar-nav-icon">
                            <Icon name={item.icon} />
                          </span>
                          <span data-slot="project-sidebar-menu-label">{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )}
                  </For>
                </>
              )}
            </For>
          </SidebarMenu>
        </div>
      </SidebarContent>
      <Show when={props.footer}>{(footer) => <SidebarFooter>{footer()}</SidebarFooter>}</Show>
    </Sidebar>
  )
}
