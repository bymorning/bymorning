import { createContext, useContext, type Accessor, type ParentProps } from "solid-js"
import "./overlay-host.css"

const OverlayHostContext = createContext<Accessor<HTMLElement | undefined>>()

export function OverlayHost(props: ParentProps) {
  let host: HTMLDivElement | undefined

  return (
    <OverlayHostContext.Provider value={() => host}>
      {props.children}
      <div
        ref={(element) => {
          host = element
        }}
        data-component="overlay-host"
      />
    </OverlayHostContext.Provider>
  )
}

export function useOverlayHost() {
  return useContext(OverlayHostContext)
}
