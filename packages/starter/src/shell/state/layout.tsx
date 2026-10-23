import { createContext, onCleanup, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"

function createLayout() {
  const media = matchMedia("(max-width: 767px)")
  const [state, setState] = createStore({
    mobile: media.matches,
    width: 260,
    open: false,
    desktopMount: undefined as HTMLElement | undefined,
    mobileMount: undefined as HTMLElement | undefined,
  })
  const close = () => setState("open", false)
  const update = () => setState({ mobile: media.matches, open: media.matches && state.open })
  media.addEventListener("change", update)
  addEventListener("popstate", close)
  onCleanup(() => {
    media.removeEventListener("change", update)
    removeEventListener("popstate", close)
  })
  return {
    state,
    close,
    open: (open: boolean) => setState("open", open),
    resize: (width: number) => setState("width", width),
    mount: (side: "desktopMount" | "mobileMount", element: HTMLElement | undefined) => setState(side, element),
    navigation: () => (state.mobile ? state.mobileMount : state.desktopMount),
  }
}

const LayoutContext = createContext<ReturnType<typeof createLayout>>()

export function LayoutProvider(props: ParentProps) {
  const layout = createLayout()
  return <LayoutContext.Provider value={layout}>{props.children}</LayoutContext.Provider>
}

export function useLayout() {
  const layout = useContext(LayoutContext)
  if (!layout) throw new Error("LayoutProvider is missing")
  return layout
}
