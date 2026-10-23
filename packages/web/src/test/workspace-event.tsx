import { QueryClientProvider } from "@tanstack/solid-query"
import type { ParentProps } from "solid-js"
import { useSDK } from "../context/sdk"
import { useWorkspace } from "../context/workspace"
import { WorkspaceEventProvider as Adapter } from "../context/workspace-event"
import { createQuery } from "../runtime/server/query"
import { ServerProvider } from "../runtime/server/runtime"

/** Match the production runtime ownership around legacy consumer fixtures. */
export function WorkspaceEventProvider(props: ParentProps) {
  const sdk = useSDK()
  const workspace = useWorkspace()
  const query = createQuery()
  return (
    <QueryClientProvider client={query}>
      <ServerProvider
        scope={{ origin: sdk.baseURL, identity: "test", workspace: workspace.current().id, api: sdk.client }}
      >
        <Adapter>{props.children}</Adapter>
      </ServerProvider>
    </QueryClientProvider>
  )
}
