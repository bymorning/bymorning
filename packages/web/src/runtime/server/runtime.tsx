import { createContext, onCleanup, useContext, type ParentProps } from "solid-js"
import { useQueryClient } from "@tanstack/solid-query"
import { createServer, type ServerSync } from "./sync"
import type { ServerScope } from "./scope"

const context = createContext<{ scope: ServerScope; server: ServerSync }>()

export function ServerProvider(props: ParentProps<{ readonly scope: ServerScope }>) {
  const scope = props.scope
  const server = createServer(scope, useQueryClient())
  onCleanup(() => {
    void server.close()
  })
  return <context.Provider value={{ scope, server }}>{props.children}</context.Provider>
}

const useRuntime = () => {
  const value = useContext(context)
  if (!value) throw new Error("ServerProvider is missing")
  return value
}
export const useServer = () => useRuntime().server
export const useScope = () => useRuntime().scope
