import type { WorkspaceAccessInfo } from "@bymorning/client"
import { createEffect, createMemo, For, on, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { useDialog } from "../context/dialog"
import { Dialog, DialogBody } from "../ui/components/dialog"
import { Icon } from "../ui/components/icon"
import { TextInput } from "../ui/components/text-input"
import "./workspace-switcher-dialog.css"

const listboxID = "workspace-switcher-listbox"
const optionID = (id: string) => `workspace-switcher-option-${id}`

export function WorkspaceSwitcherDialog(props: {
  readonly workspaces: ReadonlyArray<WorkspaceAccessInfo>
  readonly currentID: string
  readonly onSelect: (workspace: WorkspaceAccessInfo) => void
}): JSX.Element {
  const dialog = useDialog()
  const [state, setState] = createStore({ query: "", activeID: props.currentID })
  const workspaces = createMemo(() => {
    const needle = state.query.trim().toLowerCase()
    return props.workspaces.filter((workspace) => workspace.name.toLowerCase().includes(needle))
  })
  createEffect(
    on(workspaces, (items) => {
      if (items.some((workspace) => workspace.id === state.activeID)) return
      setState("activeID", items[0]?.id ?? "")
    }),
  )

  const move = (delta: -1 | 1) => {
    const items = workspaces()
    if (items.length === 0) return
    const current = items.findIndex((workspace) => workspace.id === state.activeID)
    const index = current === -1 ? 0 : (current + delta + items.length) % items.length
    setState("activeID", items[index]!.id)
    requestAnimationFrame(() => document.getElementById(optionID(items[index]!.id))?.scrollIntoView?.({ block: "nearest" }))
  }
  const select = (workspace: WorkspaceAccessInfo | undefined) => {
    if (!workspace) return
    dialog.close()
    if (workspace.id !== props.currentID) props.onSelect(workspace)
  }

  return (
    <Dialog data-component="workspace-switcher-dialog" aria-label="Switch workspace" fit>
      <DialogBody>
        <div data-slot="workspace-switcher-search">
          <TextInput
            autofocus
            autocomplete="off"
            spellcheck={false}
            appearance="command"
            role="combobox"
            aria-label="Search workspaces"
            aria-autocomplete="list"
            aria-controls={listboxID}
            aria-expanded="true"
            aria-activedescendant={state.activeID ? optionID(state.activeID) : undefined}
            placeholder="Search workspaces"
            leadingIcon={<Icon name="magnifying-glass" />}
            value={state.query}
            onInput={(event) => {
              setState({ query: event.currentTarget.value, activeID: "" })
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault()
                move(event.key === "ArrowDown" ? 1 : -1)
                return
              }
              if (event.key !== "Enter") return
              event.preventDefault()
              select(workspaces().find((workspace) => workspace.id === state.activeID))
            }}
          />
        </div>
        <div id={listboxID} data-slot="workspace-switcher-results" role="listbox" aria-label="Workspaces">
          <Show when={workspaces().length > 0} fallback={<p data-slot="workspace-switcher-empty">No workspaces found</p>}>
            <For each={workspaces()}>
              {(workspace) => {
                const current = workspace.id === props.currentID
                return (
                  <button
                    id={optionID(workspace.id)}
                    type="button"
                    role="option"
                    aria-selected={state.activeID === workspace.id}
                    aria-current={current ? "true" : undefined}
                    data-active={state.activeID === workspace.id ? "" : undefined}
                    data-slot="workspace-switcher-row"
                    onMouseMove={() => setState("activeID", workspace.id)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => select(workspace)}
                  >
                    <span data-slot="workspace-switcher-avatar" aria-hidden="true">{workspace.name.trim().slice(0, 1).toUpperCase() || "W"}</span>
                    <span data-slot="workspace-switcher-name">{workspace.name}</span>
                    <Show when={current}>
                      <span data-slot="workspace-switcher-current">Current</span>
                      <Icon name="central-checkmark-small" />
                    </Show>
                  </button>
                )
              }}
            </For>
          </Show>
        </div>
      </DialogBody>
    </Dialog>
  )
}
