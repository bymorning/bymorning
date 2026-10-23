import { createSignal, For, onCleanup, Show, type JSX } from "solid-js"

import { DropdownMenu } from "../../ui/components/dropdown-menu"
import { Icon } from "../../ui/components/icon"
import { type ColorScheme } from "../../ui/theme"
import "./account-menu.css"

const schemes: ReadonlyArray<{ readonly id: ColorScheme; readonly label: string }> = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
]

/** First character of the identity, upper-cased for the avatar. */
export const initial = (identity: string) => Array.from(identity.trim())[0]?.toUpperCase() ?? ""

export function AccountMenu(props: {
  readonly identity: string
  readonly workspaceName: string
  readonly scheme: ColorScheme
  readonly consoleAvailable?: boolean
  readonly onOpenConsole?: () => void
  readonly onOpenSessions?: () => void
  readonly onSchemeChange: (scheme: ColorScheme) => void
  readonly onLogout: () => void
}): JSX.Element {
  const [open, setOpen] = createSignal(false)
  let closeTimer: ReturnType<typeof setTimeout> | undefined
  let closeAction: (() => void) | undefined
  let disposed = false
  onCleanup(() => {
    disposed = true
    clearTimeout(closeTimer)
  })

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      // A reopened menu discards the action an earlier selection stashed.
      clearTimeout(closeTimer)
      closeAction = undefined
    }
  }

  // A dialog opened from an item must not mount from onSelect: the menu keeps
  // its modal hiding and item focus until its content unmounts, and a dialog
  // mounted earlier is hidden or dismissed by the still-closing menu. Kobalte
  // reports that completion as the content's close auto-focus; the extra tick
  // lets its trigger focus restore land first.
  const runCloseAction = () => {
    const action = closeAction
    closeAction = undefined
    if (disposed || !action) return
    clearTimeout(closeTimer)
    closeTimer = setTimeout(() => {
      if (!disposed) action()
    })
  }

  return (
    <div data-component="account-menu">
      <DropdownMenu open={open()} placement="top-start" gutter={6} onOpenChange={handleOpenChange}>
        <div data-slot="account-menu-trigger-host">
          <DropdownMenu.Trigger aria-label="Open account menu">
            <span data-slot="account-menu-trigger">
              <span data-slot="account-avatar">{initial(props.identity)}</span>
              <span data-slot="account-identity">
                <strong>{props.identity}</strong>
                <small>{props.workspaceName}</small>
              </span>
              <span data-slot="account-more">
                <Icon name="central-horizontal-dots" />
              </span>
            </span>
          </DropdownMenu.Trigger>
        </div>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="account-menu-popover" onCloseAutoFocus={runCloseAction}>
            <div data-slot="account-summary">
              <span data-slot="account-avatar">{initial(props.identity)}</span>
              <span data-slot="account-summary-identity">
                <strong>{props.identity}</strong>
                <small>{props.workspaceName}</small>
              </span>
            </div>
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              onSelect={() => {
                closeAction = () => props.onOpenSessions?.()
              }}
            >
              <span>Login sessions</span>
            </DropdownMenu.Item>
            <Show when={props.consoleAvailable}>
              <DropdownMenu.Item onSelect={() => props.onOpenConsole?.()}>
                <span>Console</span>
              </DropdownMenu.Item>
            </Show>
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger>
                <span data-slot="account-theme-label">Theme</span>
                <span data-slot="account-menu-value">{schemes.find((item) => item.id === props.scheme)?.label}</span>
                <Icon name="central-chevron-right-small" />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent class="account-theme-popover">
                  <DropdownMenu.RadioGroup value={props.scheme}>
                    <For each={schemes}>
                      {(scheme) => (
                        <DropdownMenu.RadioItem
                          value={scheme.id}
                          onSelect={() => {
                            props.onSchemeChange(scheme.id)
                            // The submenu would otherwise only close itself; dismiss the whole account menu.
                            setOpen(false)
                          }}
                        >
                          <DropdownMenu.ItemLabel>{scheme.label}</DropdownMenu.ItemLabel>
                          <DropdownMenu.ItemIndicator>
                            <Icon name="central-checkmark-small" />
                          </DropdownMenu.ItemIndicator>
                        </DropdownMenu.RadioItem>
                      )}
                    </For>
                  </DropdownMenu.RadioGroup>
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onSelect={props.onLogout}>
              <Icon name="central-logout" />
              <span>Log Out</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  )
}
