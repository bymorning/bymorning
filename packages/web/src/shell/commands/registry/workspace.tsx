import type { WorkspaceAccessInfo } from "@bymorning/client"
import { useNavigate } from "@solidjs/router"
import type { Accessor } from "solid-js"

export function createWorkspaceCommands(
  workspaces: Accessor<ReadonlyArray<WorkspaceAccessInfo>>,
  currentID: Accessor<string | undefined>,
) {
  const navigate = useNavigate()
  return () =>
    workspaces().map((option) => ({
      id: `workspace.${option.id}`,
      title: option.name,
      category: "Workspaces",
      ...(currentID() === option.id ? { meta: "Current" } : {}),
      onSelect: () => {
        if (currentID() !== option.id) navigate(`/w/${option.id}`)
      },
    }))
}
