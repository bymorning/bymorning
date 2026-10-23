import { createContext, createMemo, Show, useContext, type ParentProps } from "solid-js"

// `object` rather than `Record<string, unknown>`: providers are used directly as
// router components, and interface props (e.g. RouteSectionProps) have no implicit
// index signature — `Record<string, any>` only ever worked through the `any` escape.
export function createSimpleContext<T extends object, Props extends object>(
  input: {
    name: string
    init: ((input: Props) => T) | (() => T)
  } & (T extends { ready: unknown } ? { gate: boolean } : { gate?: boolean }),
) {
  const ctx = createContext<T>()

  return {
    provider: (props: ParentProps<Props>) => {
      const init = input.init(props)
      const gate = input.gate ?? true

      if (!gate) {
        return <ctx.Provider value={init}>{props.children}</ctx.Provider>
      }

      // Access init.ready inside the memo to make it reactive for getter properties
      const isReady = createMemo(() => {
        const ready = "ready" in init ? init.ready : undefined
        return ready === undefined || (typeof ready === "function" ? ready() : ready)
      })
      return (
        <Show when={isReady()}>
          <ctx.Provider value={init}>{props.children}</ctx.Provider>
        </Show>
      )
    },
    use: () => {
      const value = useContext(ctx)
      if (!value) throw new Error(`${input.name} context must be used within a context provider`)
      return value
    },
    optional: () => useContext(ctx),
  }
}
