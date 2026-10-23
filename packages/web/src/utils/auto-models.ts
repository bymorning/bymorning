import type { ByMorningClient } from "@bymorning/client"
import type * as Workspace from "@bymorning/schema/workspace"
import { createResource } from "solid-js"

/**
 * Auto names the Workspace's routing rules currently resolve. Offered in model pickers ahead of Catalog
 * Models; a failed lookup offers none rather than blocking selection.
 */
export function createAutoModels(input: { readonly api: ByMorningClient; readonly workspace: Workspace.ID }) {
  const [names] = createResource(
    () => input.workspace,
    async (workspace) => {
      try {
        return await input.api.model.auto({ workspace })
      } catch {
        return []
      }
    },
    { initialValue: [] },
  )
  return () => names.latest ?? []
}
