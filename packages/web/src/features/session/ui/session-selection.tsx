import {
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  Show,
  useContext,
  type Accessor,
  type JSX,
} from "solid-js"

import { createSimpleContext } from "../../../context/helper"
import { Select } from "../../../ui/components/select"
import { Icon } from "../../../ui/components/icon"
import { IconButton } from "../../../ui/components/icon-button"
import { Menu } from "../../../ui/components/menu"
import { Tooltip } from "../../../ui/components/tooltip"
import { useI18n } from "../../../ui/context/i18n"
import { ModelSelectorPopover } from "../../../ui/components/select-dialog"
import { useComposer } from "./session-composer/context"
import { reclaimFocus } from "./session-composer/reclaim-focus"
import { WorkspaceRoutePath, workspaceIDFromPath, workspaceRouteHref } from "../../../workspace-route-paths"
import "./session-selection.css"

/** Open the composer model picker from transcript recovery actions. */
export const { provider: ModelPickerProvider, optional: useModelPicker } = createSimpleContext({
  name: "ModelPicker",
  init: () => {
    const listeners = new Set<() => void>()
    return {
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      open: () => {
        for (const listener of listeners) listener()
      },
    }
  },
})

export declare namespace SessionSelection {
  export interface Option {
    readonly key: string
    readonly label: string
  }
  export interface Choice {
    readonly options: Accessor<ReadonlyArray<Option>>
    readonly current: Accessor<string | undefined>
    readonly pending: Accessor<boolean>
    readonly select: (key: string) => void
  }
  export interface Model {
    readonly agent: Choice
    readonly model: Choice
    readonly variant: Choice
    readonly error: Accessor<string | undefined>
  }
}

type OpenMenu = "add" | "agent" | "model" | "variant"
interface SelectionContext extends SessionSelection.Model {
  readonly menu: Accessor<OpenMenu | undefined>
  readonly open: (menu: OpenMenu, open: boolean) => void
  /** Called when a Model was picked, so the composer gets focus back for good. */
  readonly picked: () => void
}

const Context = createContext<SelectionContext>()
const useSelection = () => {
  const value = useContext(Context)
  if (!value) throw new Error("SessionSelection parts must be inside SessionSelection")
  return value
}

export function SessionSelection(props: {
  readonly model: SessionSelection.Model
  readonly showAgent: boolean
  readonly showVariant: boolean
}): JSX.Element {
  const composer = useComposer()
  const [menu, setMenu] = createSignal<OpenMenu>()
  const open = (name: OpenMenu, value: boolean) => {
    if (value) {
      setMenu(name)
      return
    }
    queueMicrotask(() => {
      if (menu() !== name) return
      setMenu(undefined)
      composer.restoreFocus()
    })
  }
  // The picker returns focus to its trigger, and that trigger is disabled while the new Model is saved,
  // which drops focus to the page. Reclaim focus for the composer once both have settled.
  let reclaim = false
  let reclaimTimer: ReturnType<typeof setTimeout> | undefined
  const settle = () => {
    const pending = props.model.model.pending()
    if (!reclaim || pending) return
    reclaim = false
    reclaimFocus(composer.restoreFocus)
  }
  createEffect(settle)
  onCleanup(() => clearTimeout(reclaimTimer))
  const picked = () => {
    reclaim = true
    clearTimeout(reclaimTimer)
    reclaimTimer = setTimeout(settle)
  }
  const picker = useModelPicker()
  const unsubscribe = picker?.subscribe(() => open("model", true))
  onCleanup(() => unsubscribe?.())
  const value: SelectionContext = {
    get agent() {
      return props.model.agent
    },
    get model() {
      return props.model.model
    },
    get variant() {
      return props.model.variant
    },
    get error() {
      return props.model.error
    },
    menu,
    open,
    picked,
  }
  return (
    <Context.Provider value={value}>
      <div data-component="session-selection">
        <SelectionAttachment />
        <Show when={props.showAgent}>
          <SelectionAgent />
        </Show>
        <SelectionModel />
        <Show when={props.showVariant}>
          <SelectionVariant />
        </Show>
        <SelectionError />
      </div>
    </Context.Provider>
  )
}

function SelectionAgent(): JSX.Element {
  const value = useSelection()
  const current = () => value.agent.options().find((item) => item.key === value.agent.current())
  return (
    <div data-slot="session-selection-choice">
      <Select<SessionSelection.Option>
        aria-label="Agent"
        appearance="inline"
        placement="top-start"
        options={[...value.agent.options()]}
        current={current()}
        value={(item) => item.key}
        label={(item) => item.label}
        disabled={value.agent.pending()}
        open={value.menu() === "agent"}
        onOpenChange={(open) => value.open("agent", open)}
        onSelect={(item) => {
          if (item !== null) value.agent.select(item.key)
        }}
      />
    </div>
  )
}

function SelectionAttachment(): JSX.Element {
  const composer = useComposer()
  const selection = useSelection()
  const language = useI18n()
  let input: HTMLInputElement | undefined
  let firstFrame: number | undefined
  let secondFrame: number | undefined
  onCleanup(() => {
    if (firstFrame !== undefined) cancelAnimationFrame(firstFrame)
    if (secondFrame !== undefined) cancelAnimationFrame(secondFrame)
  })
  const insert = (trigger: "/" | "@") => {
    const editor = composer.editor()
    if (!editor) return
    const cursor = Math.min(composer.cursor() ?? composer.value().length, composer.value().length)
    editor.replace({ start: cursor, end: cursor }, trigger)
    const inserted = { value: composer.value(), cursor: composer.cursor() }
    if (firstFrame !== undefined) cancelAnimationFrame(firstFrame)
    if (secondFrame !== undefined) cancelAnimationFrame(secondFrame)
    firstFrame = requestAnimationFrame(() => {
      firstFrame = undefined
      secondFrame = requestAnimationFrame(() => {
        secondFrame = undefined
        if (composer.value() !== inserted.value || composer.cursor() !== inserted.cursor) return
        composer.restoreFocus()
        composer.commands.trigger(trigger)
      })
    })
  }
  return (
    <>
      <Tooltip value={language.t("ui.session.composer.add")} placement="top">
        <Menu
          modal={false}
          gutter={6}
          placement="top-start"
          open={selection.menu() === "add"}
          onOpenChange={(open) => selection.open("add", open)}
        >
          <Menu.Trigger
            as={IconButton}
            type="button"
            size="small"
            variant="ghost-muted"
            aria-label={language.t("ui.session.composer.add")}
            icon={<Icon name="plus" size="small" />}
          />
          <Menu.Portal>
            <Menu.Content data-slot="session-composer-add-menu" onCloseAutoFocus={(event) => event.preventDefault()}>
              <Menu.Item disabled={composer.attachments.disabled()} onSelect={() => input?.click()}>
                {language.t("ui.session.composer.attach")}
              </Menu.Item>
              <Menu.Separator />
              <Show when={(composer.slashCommands?.search("/")?.length ?? 0) > 0}>
                <Menu.Item shortcut="/" onSelect={() => insert("/")}>
                  {language.t("ui.session.composer.commands")}
                </Menu.Item>
              </Show>
              <Menu.Item shortcut="@" onSelect={() => insert("@")}>
                {language.t("ui.session.composer.context")}
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu>
      </Tooltip>
      <input
        ref={(node) => (input = node)}
        class="sr-only"
        type="file"
        tabindex={-1}
        multiple
        aria-label={language.t("ui.session.composer.attach")}
        onChange={(event) => {
          if (event.currentTarget.files) composer.attachments.add(event.currentTarget.files)
          event.currentTarget.value = ""
          composer.restoreFocus()
        }}
      />
    </>
  )
}

function SelectionModel(): JSX.Element {
  const value = useSelection()
  const current = () => value.model.options().find((item) => item.key === value.model.current())
  const workspaceID = workspaceIDFromPath(window.location.pathname)
  const modelsHref = workspaceID ? workspaceRouteHref(workspaceID, WorkspaceRoutePath.gatewayModels) : undefined
  return (
    <ModelSelectorPopover
      model={{
        get options() {
          return value.model.options
        },
        get current() {
          return value.model.current
        },
        get pending() {
          return value.model.pending
        },
        select: (key: string) => {
          value.picked()
          value.model.select(key)
        },
      }}
      open={value.menu() === "model"}
      onOpenChange={(open) => value.open("model", open)}
      {...(modelsHref ? { actionHref: modelsHref, actionLabel: "Manage models" } : {})}
      trigger={(triggerProps) => (
        <button
          {...triggerProps}
          type="button"
          data-slot="model-selector-trigger"
          aria-label={`Model${current() ? `, ${current()!.label}` : ""}`}
          disabled={value.model.pending()}
        >
          <span data-slot="model-selector-trigger-label">{current()?.label ?? "Model"}</span>
          <Icon name="chevron-down" size="small" />
        </button>
      )}
    />
  )
}

function SelectionVariant(): JSX.Element {
  const value = useSelection()
  const current = () => value.variant.options().find((item) => item.key === value.variant.current())
  return (
    <Show when={value.variant.options().length > 1}>
      <div data-slot="session-selection-choice">
        <Select<SessionSelection.Option>
          aria-label="Variant"
          appearance="inline"
          placement="top-start"
          options={[...value.variant.options()]}
          current={current()}
          value={(item) => item.key}
          label={(item) => item.label}
          disabled={value.variant.pending()}
          open={value.menu() === "variant"}
          onOpenChange={(open) => value.open("variant", open)}
          onSelect={(item) => {
            if (item !== null) value.variant.select(item.key)
          }}
        />
      </div>
    </Show>
  )
}

function SelectionError(): JSX.Element {
  const value = useSelection()
  return (
    <Show when={value.error()}>
      {(message) => (
        <span data-slot="session-selection-error" role="alert">
          {message()}
        </span>
      )}
    </Show>
  )
}
