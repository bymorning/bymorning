import { createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js"

import { DropdownMenu } from "./dropdown-menu"
import { Icon } from "./icon"
import "./material-picker.css"

export interface MaterialPickerProps<Item> {
  readonly items: ReadonlyArray<Item>
  readonly key: (item: Item) => string
  readonly label: (item: Item) => string
  readonly selected?: string | undefined
  readonly searchLabel: string
  readonly emptyLabel: string
  readonly triggerLabel: string
  readonly triggerTitle?: string
  readonly trigger: JSX.Element
  readonly leading: (item: Item) => JSX.Element
  readonly disabled?: boolean
  readonly placement?: "bottom" | "bottom-start"
  readonly appearance?: "base" | "workspace-picker"
  readonly class?: string
  readonly onSelect: (item: Item) => void
  readonly footer?: {
    readonly label: string
    readonly icon: JSX.Element
    readonly onSelect: () => void
  }
}

export function MaterialPicker<Item>(props: MaterialPickerProps<Item>): JSX.Element {
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal("")
  let trigger: HTMLButtonElement | undefined
  let search: HTMLInputElement | undefined
  let focusTimer: ReturnType<typeof setTimeout> | undefined
  let closeAction: (() => void) | undefined
  const items = createMemo(() => {
    const needle = query().toLowerCase()
    return props.items.filter((item) => props.label(item).toLowerCase().includes(needle))
  })
  onCleanup(() => clearTimeout(focusTimer))

  return (
    <DropdownMenu
      open={open()}
      placement={props.placement ?? "bottom-start"}
      gutter={6}
      onOpenChange={(open) => {
        setOpen(open)
        if (open) {
          return
        }
        clearTimeout(focusTimer)
        setQuery("")
        const action = closeAction
        closeAction = undefined
        focusTimer = setTimeout(() => action ? action() : trigger?.focus())
      }}
    >
      <DropdownMenu.Trigger
        ref={trigger}
        aria-label={props.triggerLabel}
        title={props.triggerTitle}
        disabled={props.disabled}
        appearance={props.appearance ?? "workspace-picker"}
      >
        {props.trigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          class={props.class}
          classList={{ "material-picker-popover": true }}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            focusTimer = setTimeout(() => search?.focus())
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <div data-slot="material-picker-search">
            <Icon name="central-search" />
            <input
              ref={search}
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") return
                if (event.key === "ArrowDown") {
                  event.preventDefault()
                  event.currentTarget
                    .closest('[data-component="dropdown-menu-content"]')
                    ?.querySelector<HTMLElement>('[data-slot="dropdown-menu-radio-item"]')
                    ?.focus()
                  return
                }
                event.stopPropagation()
              }}
              placeholder={props.searchLabel}
              aria-label={props.searchLabel}
            />
          </div>
          <div data-slot="material-picker-results">
            <DropdownMenu.RadioGroup value={props.selected}>
              <For each={items()}>
                {(item) => (
                  <DropdownMenu.RadioItem
                    value={props.key(item)}
                    onSelect={() => {
                      props.onSelect(item)
                      setOpen(false)
                    }}
                  >
                    <span data-slot="material-picker-row-leading">{props.leading(item)}</span>
                    <DropdownMenu.ItemLabel>{props.label(item)}</DropdownMenu.ItemLabel>
                    <DropdownMenu.ItemIndicator><Icon name="central-checkmark-small" /></DropdownMenu.ItemIndicator>
                  </DropdownMenu.RadioItem>
                )}
              </For>
              <Show when={items().length === 0}><p data-slot="material-picker-empty">{props.emptyLabel}</p></Show>
            </DropdownMenu.RadioGroup>
          </div>
          <Show when={props.footer}>
            {(footer) => (
              <div data-slot="material-picker-footer">
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={() => { closeAction = footer().onSelect }}>
                  <span data-slot="material-picker-row-leading">{footer().icon}</span>
                  <DropdownMenu.ItemLabel>{footer().label}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </div>
            )}
          </Show>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
