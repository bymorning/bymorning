import { type JSX } from "solid-js"

import { Icon, type IconProps } from "./icon"
import { IconButton } from "./icon-button"
import { Menu } from "./menu"
import { useOverlayHost } from "./overlay-host"
import { Tooltip } from "./tooltip"
import "./action-menu.css"

export function ActionMenu(props: {
  readonly label: string
  readonly disabled?: boolean
  readonly icon?: IconProps["name"]
  readonly triggerLabel?: string
  readonly children: JSX.Element
}): JSX.Element {
  const overlayHost = useOverlayHost()

  return (
    <Tooltip value={props.triggerLabel ?? `Actions for ${props.label}`} placement="top">
      <Menu modal={false} placement="bottom-end" hideWhenDetached>
        <Menu.Trigger
          as={IconButton}
          type="button"
          size="small"
          variant="ghost-muted"
          disabled={props.disabled}
          aria-label={props.triggerLabel ?? `Actions for ${props.label}`}
          data-slot="action-menu-trigger"
          icon={<Icon name={props.icon ?? "central-horizontal-dots"} />}
        />
        <Menu.Portal
          {...(overlayHost
            ? {
                get mount() {
                  return overlayHost()!
                },
              }
            : {})}
        >
          <Menu.Content data-slot="action-menu-content">
            <Menu.Group>{props.children}</Menu.Group>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
    </Tooltip>
  )
}

ActionMenu.Item = Menu.Item
ActionMenu.Separator = Menu.Separator
