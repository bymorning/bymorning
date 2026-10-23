import { type JSX } from "solid-js"
import { useI18n } from "../context/i18n"

import { Icon, type IconProps } from "./icon"
import { IconButton } from "./icon-button"
import { Menu } from "./menu"
import "./action-menu.css"

export function ActionMenu(props: {
  readonly label: string
  readonly disabled?: boolean
  readonly icon?: IconProps["name"]
  readonly triggerLabel?: string
  readonly children: JSX.Element
}): JSX.Element {
  const i18n = useI18n()

  return (
    <Menu modal={false} placement="bottom-end" hideWhenDetached>
      <Menu.Trigger
        as={IconButton}
        type="button"
        size="small"
        variant="ghost-muted"
        disabled={props.disabled}
        aria-label={props.triggerLabel ?? i18n.t("ui.actionMenu.label", { label: props.label })}
        data-slot="action-menu-trigger"
        icon={<Icon name={props.icon ?? "central-horizontal-dots"} />}
      />
      <Menu.Portal>
        <Menu.Content data-slot="action-menu-content">
          <Menu.Group>{props.children}</Menu.Group>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}

ActionMenu.Item = Menu.Item
ActionMenu.Separator = Menu.Separator
