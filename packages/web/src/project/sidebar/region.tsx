import { createEffect, on, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import type { IconProps } from "../../ui/components/icon"
import { useProject, type ProjectModel } from "../model"
import { ProjectSidebarView } from "./view"
import { type ConsoleSidebarItemID, type ProjectSidebarPane, type WorkspaceRouteID } from "./navigation"

export function ProjectSidebarRegion(props: {
  readonly controller?: ProjectModel
  readonly footer?: JSX.Element
  readonly onDismiss: () => void
  readonly searchLabel?: string
  readonly projects?: JSX.Element
  readonly onOpenSearch?: () => void
  readonly onReturnToMain?: (() => void) | undefined
  readonly gateway?: {
    readonly active: boolean
    readonly currentItem?: ConsoleSidebarItemID | undefined
    readonly onSelectItem: (item: ConsoleSidebarItemID) => void
  }
  readonly routes?: ReadonlyArray<{
    readonly id: WorkspaceRouteID
    readonly label: string
    readonly icon: IconProps["name"]
    readonly active: boolean
    readonly onSelect: () => void
  }>
}): JSX.Element {
  const controller = props.controller ?? useProject()
  const [navigation, setNavigation] = createStore<{
    pane: ProjectSidebarPane
    transition?: "forward" | "backward"
  }>({
    pane: props.gateway?.active ? "console" : "main",
  })
  createEffect(
    on(
      () => props.gateway?.active,
      (active, previous) => {
        if (previous === undefined) return
        if (!active) {
          setNavigation("pane", "main")
          setNavigation("transition", undefined)
          return
        }
        if (navigation.pane === "main") {
          setNavigation("pane", "console")
          setNavigation("transition", undefined)
        }
      },
    ),
  )
  return (
    <ProjectSidebarView
      footer={props.footer}
      pane={navigation.pane}
      transition={navigation.transition}
      gatewayCurrentItem={props.gateway?.currentItem}
      canCreateSession={controller.session.canCreate()}
      createDisabled={controller.session.createDisabled()}
      routes={props.routes?.map((route) => ({
        ...route,
        onSelect: () => {
          setNavigation("pane", "main")
          setNavigation("transition", undefined)
          route.onSelect()
        },
      }))}
      searchLabel={props.searchLabel}
      projects={props.projects}
      onOpenSearch={props.onOpenSearch}
      onTransitionEnd={() => setNavigation("transition", undefined)}
      returnToMain={() => setNavigation({ pane: "main", transition: "backward" })}
      onReturnToMain={() => {
        props.onReturnToMain?.()
        // Back navigates away like every other drawer item, so it closes the phone drawer too.
        props.onDismiss()
      }}
      selectGatewayItem={(item) => {
        props.gateway?.onSelectItem(item)
        props.onDismiss()
      }}
      onCreateSession={() => {
        if (controller.session.create()) props.onDismiss()
      }}
    />
  )
}
