import {
  batch,
  createContext,
  createEffect,
  createRoot,
  createSignal,
  For,
  getOwner,
  onCleanup,
  runWithOwner,
  type JSX,
  type Owner,
  type ParentProps,
  useContext,
} from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { makeEventListener } from "@solid-primitives/event-listener"

type DialogElement = () => JSX.Element

interface Active {
  readonly id: string
  readonly node: JSX.Element
  readonly dispose: () => void
  readonly owner: Owner
  readonly onClose: (() => void) | undefined
  readonly setClosing: (closing: boolean) => void
}

const Context = createContext<ReturnType<typeof init>>()

function init() {
  const [stack, setStack] = createSignal<ReadonlyArray<Active>>([])
  // The modal dialog. It is set before a new dialog's content mounts so the covered dialog
  // releases its focus trap first; otherwise it pulls the new dialog's autofocus back.
  const [modalID, setModalID] = createSignal<string | undefined>()
  // Each closing dialog owns its exit timer so a later close, such as dismissing the
  // dialog beneath one that is still exiting, is never dropped.
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const clearTimers = () => {
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
  }
  let restoreFocus: HTMLElement | undefined

  onCleanup(() => {
    clearTimers()
    const items = stack()
    setStack([])
    for (const item of items) item.dispose()
    restoreFocus = undefined
  })

  const close = (id?: string) => {
    const items = stack()
    const current = id ? items.find((item) => item.id === id) : items.findLast((item) => !timers.has(item.id))
    if (!current || timers.has(current.id)) return
    current.onClose?.()
    current.setClosing(true)

    const closed = current.id
    timers.set(
      closed,
      setTimeout(() => {
        timers.delete(closed)
        current.dispose()
        const remaining = stack().filter((item) => item.id !== closed)
        batch(() => {
          setStack(remaining)
          setModalID(remaining.at(-1)?.id)
        })
        if (remaining.length === 0) {
          restoreFocus?.focus({ preventScroll: true })
          restoreFocus = undefined
        }
      }, 100),
    )
  }

  createEffect(() => {
    if (stack().length === 0) return

    makeEventListener(window, "keydown", (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      close()
      event.preventDefault()
      event.stopPropagation()
    })
  })

  const mount = (element: DialogElement, owner: Owner, onClose: (() => void) | undefined, layer: number) => {
    const id = Math.random().toString(36).slice(2)
    const zIndex = 50 + layer * 10
    let dispose: (() => void) | undefined
    setModalID(id)
    let setClosing: ((closing: boolean) => void) | undefined

    const node = runWithOwner(owner, () =>
      createRoot((rootDispose: () => void) => {
        dispose = rootDispose
        const [closing, setClosingSignal] = createSignal(false)
        setClosing = setClosingSignal
        return (
          <Kobalte
            modal={modalID() === id}
            open={!closing()}
            onOpenChange={(open) => {
              if (!open && modalID() === id) close(id)
            }}
          >
            <Kobalte.Portal>
              <Kobalte.Overlay
                data-component="dialog-overlay"
                style={{ "z-index": String(zIndex) }}
                onClick={() => close(id)}
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
                {element()}
              </div>
            </Kobalte.Portal>
          </Kobalte>
        )
      }),
    )

    if (!dispose || !setClosing) {
      setModalID(stack().at(-1)?.id)
      return
    }
    const active: Active = { id, node, dispose, owner, onClose, setClosing }
    setStack((items) => [...items, active])
    runWithOwner(owner, () =>
      onCleanup(() => {
        if (!stack().includes(active)) return
        active.dispose()
        const remaining = stack().filter((item) => item !== active)
        batch(() => {
          setStack(remaining)
          setModalID(remaining.at(-1)?.id)
        })
      }),
    )
  }

  const push = (element: DialogElement, owner: Owner, onClose?: () => void) => {
    if (stack().length === 0)
      restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    mount(element, owner, onClose, stack().length)
  }

  const show = (element: DialogElement, owner: Owner, onClose?: () => void) => {
    if (stack().length === 0)
      restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    for (const item of stack()) item.dispose()
    setStack([])
    clearTimers()
    mount(element, owner, onClose, 0)
  }

  return { stack, show, push, close }
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
      dialog.close()
    },
  }
}
