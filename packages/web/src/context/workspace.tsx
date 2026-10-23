import type { WorkspaceAccessInfo } from "@bymorning/client"

import { createSimpleContext } from "./helper"

export const { use: useWorkspace, provider: WorkspaceScope } = createSimpleContext({
  name: "Workspace",
  init: (props: { readonly list: ReadonlyArray<WorkspaceAccessInfo>; readonly current: WorkspaceAccessInfo }) => ({
    list: () => props.list,
    current: () => props.current,
  }),
})

export const { use: useWorkspaceInventory, provider: WorkspaceInventoryScope } = createSimpleContext({
  name: "WorkspaceInventory",
  gate: false,
  init: (props: { readonly list: () => ReadonlyArray<WorkspaceAccessInfo>; readonly ready: () => boolean }) => props,
})
