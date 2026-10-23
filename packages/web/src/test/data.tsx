import { onCleanup, type ParentProps } from "solid-js"
import { DataProvider as Provider } from "../context/data"
import { useSDK } from "../context/sdk"
import { useWorkspace } from "../context/workspace"
import { createQuery } from "../runtime/server/query"

/** Explicit QueryClient lifetime for legacy unit fixtures without ServerProvider. */
export function DataProvider(props: ParentProps) {
  const sdk = useSDK()
  const query = createQuery()
  onCleanup(() => query.clear())
  return (
    <Provider
      directory={{
        query,
        scope: {
          origin: sdk.baseURL,
          identity: crypto.randomUUID(),
          workspace: useWorkspace().current().id,
          api: sdk.client,
        },
        ready: () => true,
      }}
    >
      {props.children}
    </Provider>
  )
}
