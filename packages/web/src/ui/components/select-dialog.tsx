import {
  createEffect,
  createMemo,
  createUniqueId,
  For,
  Show,
  type Accessor,
  type ComponentProps,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"

import { Icon } from "./icon"
import { Menu } from "./menu"
import { useOverlayHost } from "./overlay-host"
import { ScrollView } from "../scroll-view"
import { nextIndex } from "../list-navigation"
import "./select-dialog.css"

export interface SearchableSelectOption {
  readonly key: string
  readonly label: string
  readonly accessibleLabel?: string
  readonly group?: string
  readonly description?: string
  readonly hidden?: boolean
  readonly latest?: boolean
}

export interface SearchableSelectModel {
  readonly options: Accessor<ReadonlyArray<SearchableSelectOption>>
  readonly current: Accessor<string | undefined>
  readonly pending: Accessor<boolean>
  readonly select: (key: string) => void
}

type SearchableSelectTriggerProps = Omit<ComponentProps<typeof Menu.Trigger>, "as" | "ref">
type SearchableSelectTrigger = (props: SearchableSelectTriggerProps) => JSX.Element

export function SearchableSelectPopover(props: {
  readonly model: SearchableSelectModel
  readonly trigger: SearchableSelectTrigger
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly label?: string
  readonly searchLabel?: string
  readonly emptyLabel?: string
  readonly size?: "default" | "large"
  readonly optionLayout?: "stacked"
  readonly placement?: "top-start" | "bottom-start"
  readonly actionHref?: string
  readonly actionLabel?: string
}): JSX.Element {
  const controller = createSearchableSelectController({ model: props.model })

  return (
    <div data-component="model-selector" role="group" aria-label={props.label ?? "Model"}>
      <SearchableSelectPopoverView
        trigger={props.trigger}
        models={controller.models}
        groups={controller.groups}
        current={controller.current()}
        select={controller.select}
        disabled={props.model.pending()}
        open={props.open}
        onOpenChange={props.onOpenChange}
        label={props.label ?? "Model"}
        searchLabel={props.searchLabel ?? `Search ${(props.label ?? "Model").toLowerCase()}s`}
        emptyLabel={props.emptyLabel ?? `No ${(props.label ?? "Model").toLowerCase()}s found`}
        size={props.size ?? "default"}
        optionLayout={props.optionLayout}
        placement={props.placement ?? "top-start"}
        actionHref={props.actionHref}
        actionLabel={props.actionLabel}
      />
    </div>
  )
}

function createSearchableSelectController(input: { model: SearchableSelectModel }) {
  const allOptions = createMemo(() => input.model.options().filter((item) => !item.hidden))

  return {
    models: (search: string) => {
      const query = search.trim()
      const filtered = query
        ? allOptions().filter((item) =>
            matchesSearch(query, [item.label, item.key, item.group ?? "", item.description ?? ""]),
          )
        : allOptions()
      return [...filtered].sort((left, right) => left.label.localeCompare(right.label))
    },
    groups: (models: SearchableSelectOption[]) => {
      const grouped = new Map<string, SearchableSelectOption[]>()
      for (const item of models) {
        const category = item.group ?? ""
        grouped.set(category, [...(grouped.get(category) ?? []), item])
      }
      return Array.from(grouped, ([category, items]) => ({ category, items })).sort((left, right) =>
        left.category.localeCompare(right.category),
      )
    },
    current: input.model.current,
    select: (item: SearchableSelectOption) => input.model.select(item.key),
  }
}

function SearchableSelectPopoverView(props: {
  trigger: SearchableSelectTrigger
  models: (search: string) => SearchableSelectOption[]
  groups: (models: SearchableSelectOption[]) => { category: string; items: SearchableSelectOption[] }[]
  current: string | undefined
  select: (item: SearchableSelectOption) => void
  disabled: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  searchLabel: string
  emptyLabel: string
  size: "default" | "large"
  optionLayout: "stacked" | undefined
  placement: "top-start" | "bottom-start"
  actionHref: string | undefined
  actionLabel: string | undefined
}) {
  const overlayHost = useOverlayHost()
  const [store, setStore] = createStore({ search: "", active: "" })
  const identity = createUniqueId()
  const listboxID = `model-selector-listbox-${identity}`
  const optionID = (key: string) => `model-selector-option-${identity}-${encodeURIComponent(key)}`
  let triggerRef: HTMLElement | undefined
  let searchRef: HTMLInputElement | undefined
  let contentRef: HTMLDivElement | undefined
  let restoreTrigger = false
  const models = createMemo(() => props.models(store.search))
  const groups = createMemo(() => props.groups(models()))
  // Keyboard order and the initial highlight follow what is rendered: grouped, not the flat label sort.
  const keys = () => groups().flatMap((group) => group.items.map((item) => item.key))
  const initialActive = () => {
    const options = keys()
    if (props.current && options.includes(props.current)) return props.current
    return options[0] ?? ""
  }
  const activeItem = () => contentRef?.querySelector<HTMLElement>("[data-active]")
  const trigger = () =>
    [...document.querySelectorAll<HTMLElement>("[aria-controls]")].find(
      (element) => element.getAttribute("aria-controls") === contentRef?.id,
    ) ?? triggerRef
  const setOpen = (open: boolean) => {
    if (open) {
      triggerRef = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
      restoreTrigger = false
      setStore({ search: "", active: initialActive() })
      props.onOpenChange(true)
      return
    }
    setStore({ search: "", active: "" })
    props.onOpenChange(false)
  }
  const selectModel = (item: SearchableSelectOption) => {
    restoreTrigger = true
    props.select(item)
    setOpen(false)
  }
  const moveActive = (delta: 1 | -1) => {
    const options = keys()
    if (options.length === 0) return
    setStore("active", options[nextIndex(options.length, options.indexOf(store.active), delta)]!)
    queueMicrotask(() => activeItem()?.scrollIntoView?.({ block: "nearest" }))
  }
  const setSearch = (value: string) => {
    setStore({ search: value, active: props.groups(props.models(value))[0]?.items[0]?.key ?? "" })
  }

  createEffect(() => {
    if (!props.open) return
    const options = keys()
    if (!options.includes(store.active)) setStore("active", initialActive())
  })

  return (
    <Menu open={props.open} modal={false} placement={props.placement} gutter={6} onOpenChange={setOpen}>
      <Menu.Trigger as={props.trigger} disabled={props.disabled} />
      <Show when={props.open}>
        <Menu.Portal
          {...(overlayHost
            ? {
                get mount() {
                  return overlayHost()!
                },
              }
            : {})}
        >
          <Menu.Content
            ref={(element: HTMLDivElement) => (contentRef = element)}
            data-component="model-selector-popover"
            data-slot="model-selector-popover"
            data-size={props.size}
            data-option-layout={props.optionLayout}
            onOpenAutoFocus={(event) => {
              event.preventDefault()
              setTimeout(() => {
                if (!props.open) return
                searchRef?.focus()
                activeItem()?.scrollIntoView?.({ block: "nearest" })
              })
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              if (restoreTrigger) trigger()?.focus({ preventScroll: true })
              restoreTrigger = false
            }}
            onEscapeKeyDown={() => {
              restoreTrigger = true
            }}
          >
            <div data-slot="model-selector-search">
              <Icon name="magnifying-glass" size="small" />
              <input
                ref={(element) => (searchRef = element)}
                value={store.search}
                role="combobox"
                aria-label={props.searchLabel}
                aria-autocomplete="list"
                aria-controls={listboxID}
                aria-activedescendant={store.active ? optionID(store.active) : undefined}
                aria-expanded="true"
                placeholder={props.searchLabel}
                spellcheck={false}
                autocorrect="off"
                autocomplete="off"
                autocapitalize="off"
                onInput={(event) => setSearch(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Tab" || event.key === "Escape") return
                  event.stopPropagation()
                  if (event.key === "ArrowDown") {
                    event.preventDefault()
                    moveActive(1)
                    return
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault()
                    moveActive(-1)
                    return
                  }
                  if (event.key === "Enter" && !event.isComposing) {
                    event.preventDefault()
                    const item = models().find((item) => item.key === store.active)
                    if (item) selectModel(item)
                  }
                }}
              />
              <Show when={store.search.trim()}>
                <button
                  type="button"
                  data-slot="model-selector-search-clear"
                  aria-label={`Clear ${props.label.toLowerCase()} search`}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => setSearch("")}
                >
                  <Icon name="xmark-small" size="small" />
                </button>
              </Show>
              <Show when={props.actionHref && props.actionLabel}>
                <a href={props.actionHref} data-slot="model-selector-manage">
                  {props.actionLabel}
                </a>
              </Show>
            </div>
            <div data-slot="model-selector-separator" />
            <ScrollView data-slot="model-selector-scroll" tabIndex={-1}>
              <div>
                <Menu.RadioGroup
                  id={listboxID}
                  data-slot="model-selector-list"
                  role="listbox"
                  aria-label={props.label}
                  value={props.current}
                >
                  <Show
                    when={models().length > 0}
                    fallback={<div data-slot="model-selector-empty">{props.emptyLabel}</div>}
                  >
                    <For each={groups()}>
                      {(group) => (
                        <Menu.Group role="group">
                          <Show when={group.category}>
                            <Menu.GroupLabel>{group.category}</Menu.GroupLabel>
                          </Show>
                          <For each={group.items}>
                            {(item) => (
                              <Menu.RadioItem
                                id={optionID(item.key)}
                                role="option"
                                aria-label={item.accessibleLabel}
                                aria-selected={props.current === item.key}
                                value={item.key}
                                data-active={store.active === item.key ? "" : undefined}
                                onMouseEnter={() => {
                                  setStore("active", item.key)
                                  searchRef?.focus()
                                }}
                                onSelect={() => selectModel(item)}
                              >
                                <span data-slot="model-selector-option-text">
                                  <span data-slot="model-selector-option-label">{item.label}</span>
                                  <Show when={item.latest}>
                                    <small data-slot="model-selector-latest">Latest</small>
                                  </Show>
                                  <Show when={item.description}>
                                    {(description) => (
                                      <span data-slot="model-selector-option-description">{description()}</span>
                                    )}
                                  </Show>
                                </span>
                              </Menu.RadioItem>
                            )}
                          </For>
                        </Menu.Group>
                      )}
                    </For>
                  </Show>
                </Menu.RadioGroup>
              </div>
            </ScrollView>
          </Menu.Content>
        </Menu.Portal>
      </Show>
    </Menu>
  )
}

export type ModelSelectorOption = SearchableSelectOption
export type ModelSelectorModel = SearchableSelectModel

export const ModelSelectorPopover = SearchableSelectPopover

const normalizeSearch = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")

const compactSearch = (value: string) => normalizeSearch(value).replaceAll(" ", "")

const matchesSearch = (query: string, values: string[]) => {
  const search = normalizeSearch(query)
  if (!search) return true
  const compactQuery = compactSearch(query)
  return values.some((value) => normalizeSearch(value).includes(search) || compactSearch(value).includes(compactQuery))
}
