import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/solid-query"
import { createComponent, createContext, onCleanup, useContext, type ParentProps } from "solid-js"
import type { ServerScope } from "@/runtime/server/scope.js"
import { createSync, type ServerSync } from "@/runtime/server/sync.js"

const ScopeContext = createContext<ServerScope>()
const ServerContext = createContext<ServerSync>()

function client() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
      },
      mutations: { retry: false },
    },
  })
}

function ServerRoot(props: ParentProps<{ readonly scope: ServerScope; readonly query: QueryClient }>) {
  const query = useQueryClient()
  const server = createSync(props.scope, query)
  let closing = false
  const teardown = async () => {
    if (closing) return
    closing = true
    // No reconnect listener may schedule Data or file work while cancellation drains.
    server.close()
    try {
      await query.cancelQueries()
    } catch (error) {
      // Query cancellation normally resolves after aborting its signals. An abort is
      // expected teardown, while a defect remains visible to the application host.
      if (!(error instanceof DOMException && error.name === "AbortError")) console.error(error)
    } finally {
      try {
        query.clear()
        server.dispose()
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) console.error(error)
      }
    }
  }
  onCleanup(() => {
    // Solid does not await cleanup callbacks. teardown contains every rejection and
    // retains the required cancellation -> clear -> Data/Connection disposal order.
    void teardown()
  })
  return createComponent(ServerContext.Provider, {
    value: server,
    get children() {
      return props.children
    },
  })
}

export function ServerProvider(props: ParentProps<{ readonly scope: ServerScope }>) {
  const query = client()
  return createComponent(ScopeContext.Provider, {
    value: props.scope,
    get children() {
      return (
        <QueryClientProvider client={query}>
          <ServerRoot scope={props.scope} query={query}>
            {props.children}
          </ServerRoot>
        </QueryClientProvider>
      )
    },
  })
}

export function useServer(): ServerSync {
  const server = useContext(ServerContext)
  if (!server) throw new Error("ServerProvider is missing")
  return server
}

export function useScope(): ServerScope {
  const scope = useContext(ScopeContext)
  if (!scope) throw new Error("ServerProvider is missing")
  return scope
}
