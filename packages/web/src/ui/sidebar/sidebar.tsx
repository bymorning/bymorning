import { splitProps, type ComponentProps, type ParentProps } from "solid-js"

export function Sidebar(props: ParentProps<ComponentProps<"nav">>) {
  const [local, rest] = splitProps(props, ["children"])
  return <nav {...rest} data-component="sidebar">{local.children}</nav>
}

export function SidebarContent(props: ParentProps) {
  return <div data-slot="sidebar-content">{props.children}</div>
}

export function SidebarFooter(props: ParentProps) {
  return <div data-slot="sidebar-footer">{props.children}</div>
}

export function SidebarMenu(props: ParentProps) {
  return <ul data-slot="sidebar-menu">{props.children}</ul>
}

export function SidebarMenuItem(props: ParentProps) {
  return <li data-slot="sidebar-menu-item">{props.children}</li>
}

export function SidebarMenuButton(props: ParentProps<ComponentProps<"button">>) {
  const [local, rest] = splitProps(props, ["children"])
  return <button {...rest} type="button" data-slot="sidebar-menu-button">{local.children}</button>
}
