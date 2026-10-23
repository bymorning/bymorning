import { createUniqueId, For, onCleanup, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import type { CommandOption } from "../../../../shell/commands/context"
import { Icon } from "../../../../ui/components/icon"
import { useI18n } from "../../../../ui/context/i18n"
import { closesCommands, commandDirection } from "./command-interaction"
import { ComposerCompletionPopover, ComposerCompletionRow, ComposerCompletionState } from "./completion"
import { useComposer } from "./context"

export function ComposerSlashCommands(): JSX.Element {
  const composer = useComposer()
  const language = useI18n()
  const listboxID = createUniqueId()
  let results: HTMLDivElement | undefined
  const [state, setState] = createStore({ open: false, query: "", active: 0 })
  // Escape dismisses the menu for this text only; the key-up that follows re-syncs it unchanged.
  let dismissed: string | undefined
  const options = () => composer.slashCommands?.search(state.query) ?? []
  const close = () => setState({ open: false, query: "", active: 0 })
  const move = (delta: -1 | 1) => {
    if (options().length === 0) return
    setState("active", (state.active + delta + options().length) % options().length)
    requestAnimationFrame(() =>
      results?.querySelector<HTMLElement>("[data-active]")?.scrollIntoView?.({ block: "nearest" }),
    )
  }
  const select = (option: CommandOption | undefined) => {
    if (!option?.slash || !composer.editor() || !composer.slashCommands?.select(option)) return
    composer.edit("", 0)
    close()
    requestAnimationFrame(composer.restoreFocus)
  }
  onCleanup(
    composer.commands.register({
      open: () => state.open,
      controls: listboxID,
      activeDescendant: () => (options()[state.active] ? `${listboxID}-option-${state.active}` : undefined),
      matches: (editor) => {
        const found = composer.slashCommands?.search(editor.value) !== undefined
        if (!found) dismissed = undefined
        return found
      },
      sync: (editor) => {
        if (dismissed === editor.value) return
        dismissed = undefined
        if (state.open && state.query === editor.value) return
        setState({ open: true, query: editor.value, active: 0 })
      },
      keydown: (event) => {
        if (closesCommands(event)) {
          event.preventDefault()
          dismissed = state.query
          close()
          return true
        }
        const direction = commandDirection(event)
        if (direction !== undefined) {
          event.preventDefault()
          move(direction)
          return true
        }
        const option = options()[state.active]
        if ((event.key !== "Enter" && event.key !== "Tab") || !option?.slash) return false
        event.preventDefault()
        select(option)
        return true
      },
      close,
      trigger: (trigger) => {
        if (trigger !== "/") return false
        dismissed = undefined
        setState({ open: true, query: "/", active: 0 })
        return true
      },
    }),
  )
  return (
    <Show when={state.open}>
      <ComposerCompletionPopover
        ref={(element) => (results = element)}
        id={listboxID}
        kind="commands"
        label={language.t("ui.session.composer.commands")}
      >
        <Show when={options().length === 0}>
          <ComposerCompletionState>{language.t("ui.session.composer.noCommands")}</ComposerCompletionState>
        </Show>
        <For each={options()}>
          {(option, index) => (
            <ComposerCompletionRow
              id={`${listboxID}-option-${index()}`}
              kind="command"
              active={state.active === index()}
              icon={<Icon name="menu" size="small" />}
              label={`/${option.slash}`}
              description={option.description ?? option.title}
              shortcut={option.keybind}
              onActivate={() => setState("active", index())}
              onSelect={() => select(option)}
            />
          )}
        </For>
      </ComposerCompletionPopover>
    </Show>
  )
}
