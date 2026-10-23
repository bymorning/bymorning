import { Menu as KobalteMenu } from "../../../ui/components/menu"
import { copyToClipboard } from "../../../ui/clipboard"
import { createStore, type SetStoreFunction } from "solid-js/store"
import { createContext, onCleanup, onMount, Show, useContext, type JSX } from "solid-js"

type State = { text: string; rect?: DOMRect; open: boolean; pending: boolean; failed: boolean }
const Context = createContext<{ state: State; setState: SetStoreFunction<State>; select: () => void }>()
const emptyState = { text: "", open: false, pending: false, failed: false } as const

export interface TextActionItem {
  readonly label: string
  readonly failedLabel?: string
  readonly run: (text: string) => Promise<void>
}

export const TextAction = { Root, Surface, Menu: KobalteMenu, Trigger }

function Root(props: {
  readonly children: JSX.Element
  readonly streaming?: boolean
  /** Callers can replace the default Copy action with their own scoped actions. */
  readonly actions?: ReadonlyArray<TextActionItem>
}): JSX.Element {
  let root!: HTMLDivElement
  const [state, setState] = createStore<State>(emptyState)
  const clear = () => setState(emptyState)
  const select = () => {
    // Moving focus into Kobalte's menu may clear the browser Selection. The captured
    // Range is intentionally ephemeral but remains valid while this scope remains mounted.
    const selection = document.getSelection()
    if (!selection || selection.isCollapsed || !selection.rangeCount) return clear()
    // Kobalte portals the menu outside this scope. Moving focus to its Copy
    // item emits selectionchange in some browsers; retain a non-empty
    // captured selection until that menu is explicitly closed.
    if (state.open) return
    if (props.streaming) return clear()
    const range = selection.getRangeAt(0)
    const text = selection.toString()
    if (!text.trim() || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return clear()
    const interactive = (node: Node) =>
      (node instanceof Element ? node : node.parentElement)?.closest(
        "button, a, input, textarea, select, [contenteditable], [role=link]",
      )
    if (
      interactive(range.startContainer) ||
      interactive(range.endContainer) ||
      range.cloneContents().querySelector("button, a, input, textarea, select, [contenteditable], [role=link]")
    )
      return clear()
    setState({ text, rect: range.getBoundingClientRect(), open: true, pending: false, failed: false })
  }
  onMount(() => document.addEventListener("selectionchange", select))
  onCleanup(() => document.removeEventListener("selectionchange", select))
  return (
    <Context.Provider value={{ state, setState, select }}>
      <div ref={(element) => (root = element)} data-component="text-action">
        {props.children}
        <Surface clear={clear} actions={props.actions ?? [copyAction]} />
      </div>
    </Context.Provider>
  )
}

const copyAction: TextActionItem = { label: "Copy", failedLabel: "Copy failed", run: copy }

async function copy(text: string) {
  if ((await copyToClipboard(text)) !== "copied") throw new Error("Clipboard unavailable")
}

function Surface(props: { readonly clear: () => void; readonly actions: ReadonlyArray<TextActionItem> }): JSX.Element {
  const context = useContext(Context)!
  const run = async (action: TextActionItem) => {
    if (context.state.pending) return
    context.setState("pending", true)
    try {
      await action.run(context.state.text)
      props.clear()
    } catch {
      context.setState({ pending: false, failed: true })
    }
  }
  return (
    <Show when={context.state.open && context.state.rect}>
      {(rect) => (
        <KobalteMenu modal={false} open onOpenChange={(open) => !open && props.clear()}>
          <Trigger rect={rect()} />
          <KobalteMenu.Portal>
            <KobalteMenu.Content data-slot="text-action-menu" onCloseAutoFocus={(event) => event.preventDefault()}>
              {props.actions.map((action) => (
                <KobalteMenu.Item disabled={context.state.pending} onSelect={() => void run(action)}>
                  {context.state.pending
                    ? "Working…"
                    : context.state.failed
                      ? (action.failedLabel ?? `${action.label} failed`)
                      : action.label}
                </KobalteMenu.Item>
              ))}
            </KobalteMenu.Content>
          </KobalteMenu.Portal>
        </KobalteMenu>
      )}
    </Show>
  )
}

function Trigger(props: { readonly rect: DOMRect }): JSX.Element {
  return (
    <KobalteMenu.Trigger
      as="button"
      type="button"
      aria-label="Selected text actions"
      style={{ position: "fixed", left: `${props.rect.left}px`, top: `${props.rect.bottom}px` }}
    >
      Actions
    </KobalteMenu.Trigger>
  )
}
