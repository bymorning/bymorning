import { QueryClientProvider } from "@tanstack/solid-query"
import type { ParentProps } from "solid-js"
import { ServerProvider, useServer } from "../runtime/server/runtime"
import { createQuery } from "../runtime/server/query"
import { DataProvider } from "./data"
import { useSDK } from "./sdk"
import { useWorkspace } from "./workspace"

/** Real shared server hierarchy for provider/component tests. */
export function TestDataProvider(props: ParentProps) {
  // Some legacy fixtures already mount the real runtime via test/workspace-event.
  let existing = false
  try { useServer(); existing = true } catch {}
  if (existing) return <DataProvider>{props.children}</DataProvider>
  const sdk = useSDK()
  const workspace = useWorkspace()
  const query = createQuery()
  return <QueryClientProvider client={query}>
    <ServerProvider scope={{ origin: sdk.baseURL, identity: "test", workspace: workspace.current().id, api: sdk.client }}>
      <DataProvider>{props.children}</DataProvider>
    </ServerProvider>
  </QueryClientProvider>
}
