import { For, onCleanup, Show, type Accessor, type JSX } from "solid-js"

import { type CommandOption } from "../shell/commands/context"
import { useDialog } from "../context/dialog"
import { ScrollView } from "../ui/scroll-view"
import { Dialog, DialogBody } from "../ui/components/dialog"
import { Icon } from "../ui/components/icon"
import { Keybind } from "../ui/components/keybind"
import { TextInput } from "../ui/components/text-input"
import { createCommandDialogModel } from "./command-dialog-model"
import "./command-dialog.css"

const listboxID = "command-dialog-listbox"
const optionID = (id: string) => `command-dialog-option-${id}`

interface CommandDialogProps {
  readonly label: string
  readonly placeholder: string
  /** Visible placeholder text; the accessible name stays `placeholder`. */
  readonly hint?: string
  readonly options: Accessor<ReadonlyArray<CommandOption>>
  readonly initialLimit?: number | null
  readonly search?: (query: string, signal: AbortSignal) => Promise<ReadonlyArray<CommandOption>>
  readonly closeOnSelect?: boolean
  readonly empty?: JSX.Element
}

/** Render a searchable command-style selection dialog. */
export function CommandDialog(props: CommandDialogProps): JSX.Element {
  const dialog = useDialog()
  const model = createCommandDialogModel({
    options: props.options,
    ...(props.initialLimit === undefined ? {} : { initialLimit: props.initialLimit }),
    search: () => props.search,
  })
  const pointer = { x: undefined as number | undefined, y: undefined as number | undefined }

  let resultsRef: HTMLDivElement | undefined

  const rememberPointer = (event: MouseEvent) => {
    pointer.x = event.clientX
    pointer.y = event.clientY
  }
  window.addEventListener("mousemove", rememberPointer)
  onCleanup(() => window.removeEventListener("mousemove", rememberPointer))

  const move = (delta: -1 | 1) => {
    model.move(delta)
    requestAnimationFrame(() =>
      resultsRef?.querySelector<HTMLElement>("[data-active]")?.scrollIntoView?.({ block: "nearest" }),
    )
  }
  const select = (entry: CommandOption | undefined) => {
    model.select(entry, () => {
      if (props.closeOnSelect !== false) dialog.close()
    })
  }
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      move(1)
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      move(-1)
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      select(model.activeEntry())
    }
  }

  return (
    <Dialog
      data-component="command-dialog"
      size="large"
      aria-label={props.label}
    >
      <DialogBody>
        <div data-slot="command-dialog-body">
          <div data-slot="command-dialog-search">
            <TextInput
              value={model.query()}
              autofocus
              autocomplete="off"
              spellcheck={false}
              appearance="command"
              role="combobox"
              aria-label={props.placeholder}
              aria-autocomplete="list"
              aria-controls={listboxID}
              aria-expanded="true"
              aria-activedescendant={model.activeEntry() ? optionID(model.activeEntry()!.id) : undefined}
              placeholder={props.hint ?? props.placeholder}
              leadingIcon={<Icon name="magnifying-glass" />}
              onInput={(event) => {
                model.setQuery(event.currentTarget.value)
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div data-slot="command-dialog-scroll">
            <ScrollView fill viewportRef={(element) => (resultsRef = element)}>
              <div
                id={listboxID}
                data-slot="command-dialog-results"
                role="listbox"
                aria-label={props.label}
                onMouseMove={(event) => {
                  const moved =
                    pointer.x === undefined ||
                    pointer.y === undefined ||
                    pointer.x !== event.clientX ||
                    pointer.y !== event.clientY
                  rememberPointer(event)
                  if (!moved) return
                  const row =
                    event.target instanceof Element
                      ? event.target.closest<HTMLElement>("[data-command-entry]")
                      : undefined
                  const index = model.entries().findIndex((entry) => entry.id === row?.dataset.commandEntry)
                  if (index !== -1) model.activate(index)
                }}
              >
                <Show
                  when={model.entries().length > 0}
                  fallback={<div data-slot="command-dialog-state">{props.empty ?? "No commands found"}</div>}
                >
                  <For each={model.groupedEntries()}>
                    {(group, index) => (
                      <div
                        data-slot="command-dialog-group"
                        role="group"
                        aria-labelledby={`command-dialog-group-title-${index()}`}
                      >
                        <div id={`command-dialog-group-title-${index()}`} data-slot="command-dialog-group-title">
                          {group.category}
                        </div>
                        <For each={group.entries}>
                          {(item) => (
                            <PaletteRow
                              item={item}
                              active={model.activeEntry()?.id === item.id}
                              onSelect={() => select(item)}
                            />
                          )}
                        </For>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </ScrollView>
          </div>
        </div>
      </DialogBody>
    </Dialog>
  )
}

function PaletteRow(props: {
  readonly item: CommandOption
  readonly active: boolean
  readonly onSelect: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      id={optionID(props.item.id)}
      data-slot="command-dialog-row"
      role="option"
      aria-label={props.item.title}
      aria-selected={props.active}
      data-active={props.active ? "" : undefined}
      data-command-entry={props.item.id}
      onMouseDown={(event: MouseEvent) => event.preventDefault()}
      onClick={props.onSelect}
    >
      <div data-slot="command-dialog-row-main">
        <Show when={props.item.icon}>{(icon) => <span data-slot="command-dialog-row-icon">{icon()}</span>}</Show>
        <div data-slot="command-dialog-row-text">
          <span data-slot="command-dialog-title">{props.item.title}</span>
          <Show when={props.item.description}>
            <span data-slot="command-dialog-description">{props.item.description}</span>
          </Show>
        </div>
      </div>
      <Show when={props.item.keybind}>
        <Keybind keys={props.item.keybind ? props.item.keybind.split("+") : []} variant="neutral" />
      </Show>
      <Show when={props.item.meta}>{(meta) => <span data-slot="command-dialog-meta">{meta()}</span>}</Show>
    </button>
  )
}
