import {
  createContext,
  createEffect,
  createRoot,
  createSignal,
  For,
  getOwner,
  onCleanup,
  runWithOwner,
  type Accessor,
  type JSX,
  type Owner,
  type ParentProps,
  useContext,
} from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { makeEventListener } from "@solid-primitives/event-listener"

import { showToast } from "../ui/components/toast"
import { createForm } from "../ui/form"

type DialogElement = () => JSX.Element

interface Active {
  readonly id: string
  readonly node: JSX.Element
  readonly dispose: () => void
  readonly owner: Owner
  readonly onClose: (() => void) | undefined
  readonly setClosing: (closing: boolean) => void
  closing: boolean
  timer: ReturnType<typeof setTimeout> | undefined
  guard: Accessor<boolean> | undefined
}

export interface DialogEntry {
  readonly active: boolean
  /** Requests a user dismissal. A registered guard can refuse it. */
  dismiss(): void
  /** Completes this entry, irrespective of its dismissal guard. */
  close(): void
  /** Replaces this still-active entry without changing its stack position. */
  replace(element: DialogElement): void
  /** Installs a dismissal guard for this component lifetime. */
  guard(guard: Accessor<boolean>): void
}

const Context = createContext<ReturnType<typeof init>>()
const EntryContext = createContext<DialogEntry>()

/**
 * The element focus returns to when the dialog stack empties. A dialog opened
 * from a menu item is opened while that item has focus, but the menu unmounts
 * as it closes; restoring to the detached item would leave focus on the
 * document body. Such a dialog returns focus to the trigger that opened the
 * menu (through any submenus), which stays mounted.
 */
const restoreTarget = (): HTMLElement | undefined => {
  let element = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  for (let menu = element?.closest('[role="menu"]'); menu; menu = element?.closest('[role="menu"]')) {
    const trigger = (menu.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .map((id) => (id === "" ? null : document.getElementById(id)))
      .find((candidate): candidate is HTMLElement => candidate instanceof HTMLElement && !menu.contains(candidate))
    if (trigger === undefined) break
    element = trigger
  }
  return element
}

function init() {
  const [stack, setStack] = createSignal<ReadonlyArray<Active>>([])
  let restoreFocus: HTMLElement | undefined

  const has = (id: string) => stack().some((entry) => entry.id === id)
  const dismiss = (id?: string) => {
    const entry = id ? stack().find((item) => item.id === id) : stack().at(-1)
    if (!entry || entry.closing || entry.guard?.()) return
    close(entry.id)
  }
  const close = (id?: string) => {
    const items = stack()
    const current = id ? items.find((item) => item.id === id) : items.at(-1)
    if (!current || current.closing) return
    current.closing = true
    try {
      current.onClose?.()
    } catch (cause) {
      // A caller callback must not leave a mounted dialog permanently closing.
      console.error(cause)
    }
    current.setClosing(true)
    const closed = current.id
    current.timer = setTimeout(() => {
      current.timer = undefined
      if (!has(closed)) {
        return
      }
      current.dispose()
      setStack((entries) => {
        const remaining = entries.filter((entry) => entry.id !== closed)
        if (remaining.length === 0) {
          // Only focus lost with the dialog returns; focus the user has since
          // moved elsewhere, such as into a menu they just opened, stays put.
          const active = document.activeElement
          if (active === null || active === document.body || !active.isConnected)
            restoreFocus?.focus({ preventScroll: true })
          restoreFocus = undefined
        }
        return remaining
      })
    }, 100)
  }

  const mount = (
    element: DialogElement,
    owner: Owner,
    onClose: (() => void) | undefined,
    layer: number,
    position?: number,
  ) => {
    const id = Math.random().toString(36).slice(2)
    const zIndex = 50 + layer * 10
    let dispose: (() => void) | undefined
    let setClosing: ((closing: boolean) => void) | undefined
    let active: Active | undefined
    let dismissGuard: Accessor<boolean> | undefined
    const entry: DialogEntry = {
      get active() {
        return has(id) && !active?.closing
      },
      dismiss: () => dismiss(id),
      close: () => close(id),
      replace: (replacement) => replace(id, replacement),
      guard: (nextGuard) => {
        const previous = active?.guard ?? dismissGuard
        dismissGuard = nextGuard
        if (active) active.guard = nextGuard
        onCleanup(() => {
          if (active?.guard === nextGuard) active.guard = previous
        })
      },
    }
    const node = runWithOwner(owner, () =>
      createRoot((rootDispose: () => void) => {
        dispose = rootDispose
        const [closing, setClosingSignal] = createSignal(false)
        setClosing = setClosingSignal
        return (
          <Kobalte modal={stack().length <= layer + 1} open={!closing()} onOpenChange={(open) => !open && dismiss(id)}>
            <Kobalte.Portal>
              <Kobalte.Overlay
                data-component="dialog-overlay"
                style={{ "z-index": String(zIndex) }}
                onClick={() => dismiss(id)}
              />
              <div
                data-dialog-layer={layer}
                style={{
                  position: "fixed",
                  inset: "0",
                  "z-index": String(zIndex),
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "center",
                  "pointer-events": "none",
                }}
              >
                <EntryContext.Provider value={entry}>{element()}</EntryContext.Provider>
              </div>
            </Kobalte.Portal>
          </Kobalte>
        )
      }),
    )
    if (!dispose || !setClosing) return
    active = { id, node, dispose, owner, onClose, setClosing, closing: false, timer: undefined, guard: dismissGuard }
    setStack((items) =>
      position === undefined ? [...items, active] : [...items.slice(0, position), active, ...items.slice(position)],
    )
    runWithOwner(owner, () =>
      onCleanup(() => {
        if (!stack().includes(active)) return
        active.dispose()
        setStack((items) => items.filter((item) => item !== active))
      }),
    )
  }

  const replace = (id: string, element: DialogElement) => {
    const current = stack().find((entry) => entry.id === id)
    if (!current || current.closing) return
    const layer = stack().indexOf(current)
    if (current.timer !== undefined) clearTimeout(current.timer)
    current.dispose()
    setStack((entries) => entries.filter((entry) => entry !== current))
    mount(element, current.owner, current.onClose, layer, layer)
  }

  const push = (element: DialogElement, owner: Owner, onClose?: () => void) => {
    if (stack().length === 0) restoreFocus = restoreTarget()
    mount(element, owner, onClose, stack().length)
  }
  const show = (element: DialogElement, owner: Owner, onClose?: () => void) => {
    if (stack().length === 0) restoreFocus = restoreTarget()
    for (const item of stack()) {
      if (item.timer !== undefined) clearTimeout(item.timer)
      item.dispose()
    }
    setStack([])
    mount(element, owner, onClose, 0)
  }

  createEffect(() => {
    if (stack().length === 0) return
    makeEventListener(window, "keydown", (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      dismiss()
      event.preventDefault()
      event.stopPropagation()
    })
  })
  onCleanup(() => {
    const entries = stack()
    setStack([])
    for (const entry of entries) {
      if (entry.timer !== undefined) clearTimeout(entry.timer)
      entry.dispose()
    }
    restoreFocus = undefined
  })
  return { stack, show, push, close, dismiss }
}

export function DialogProvider(props: ParentProps) {
  const dialog = init()
  return (
    <Context.Provider value={dialog}>
      {props.children}
      <div data-component="dialog-stack">
        <For each={dialog.stack()}>{(entry) => entry.node}</For>
      </div>
    </Context.Provider>
  )
}

export function useDialog() {
  const dialog = useContext(Context)
  const owner = getOwner()
  if (!dialog || !owner) throw new Error("useDialog must be used within a DialogProvider")
  return {
    get active() {
      return dialog.stack().at(-1)
    },
    show(element: DialogElement, onClose?: () => void) {
      dialog.show(element, dialog.stack().at(-1)?.owner ?? owner, onClose)
    },
    push(element: DialogElement, onClose?: () => void) {
      dialog.push(element, dialog.stack().at(-1)?.owner ?? owner, onClose)
    },
    close() {
      dialog.dismiss()
    },
  }
}

/**
 * Access the dialog stack outside its provider lifetime. Session-wide display
 * takeovers (the session lock/expiry gate) force-close every open dialog so no
 * modal keeps the takeover hidden from assistive technology.
 */
export function useOptionalDialog() {
  const dialog = useContext(Context)
  if (!dialog) return undefined
  return {
    closeAll() {
      for (const entry of [...dialog.stack()]) dialog.close(entry.id)
    },
  }
}

/** Returns the entry that mounted the current dialog. */
export function useEntry() {
  const entry = useContext(EntryContext)
  if (!entry) throw new Error("useEntry must be used within a mounted dialog")
  return entry
}

/** Compatibility bridge for unconverted callers. New code should use createForm and FormDialog. */
export function createDialogForm<V extends object>(input: {
  readonly values: V
  readonly submit: (values: V) => Promise<unknown> | undefined
  readonly fallback: string
  readonly errorTitle?: string
  readonly onDone?: () => void
}) {
  const entry = useEntry()
  const form = createForm({
    values: input.values,
    fallback: input.fallback,
    submit: async (values) => {
      const request = input.submit(values)
      if (request === undefined) return false
      await request
      return true
    },
  })
  const values = new Proxy(form.values, {
    get(target, key, receiver) {
      if (key === "pending") return form.pending
      if (key === "error") return form.error
      return Reflect.get(target, key, receiver)
    },
  }) as V & { readonly pending: boolean; readonly error: string | undefined }
  const onSubmit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (event) => {
    event.preventDefault()
    if (!entry.active) return
    void form.submit().then((result) => {
      if (!entry.active) return
      if (result.type === "success" && result.value) {
        try {
          if (input.onDone) input.onDone()
          else entry.close()
        } catch (cause) {
          // A completed write remains completed even if the presentation callback fails.
          console.error(cause)
        }
      }
      if (result.type === "failed") {
        const description = result.message
        const title = input.errorTitle ?? input.fallback
        showToast({ variant: "error", title, ...(description === title ? {} : { description }) })
      }
    })
  }
  return { values, set: form.set, pending: () => form.pending, error: () => form.error, onSubmit }
}
