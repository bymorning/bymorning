import { createMemo, type Accessor } from "solid-js"

import { deriveListState, type ListSourceState } from "../list-state"
import type { ProjectFileListItem, ProjectFileListState } from "./project-file-list-model"

export function createProjectFileListController<ProjectID extends string>(options: {
  readonly projectID: Accessor<ProjectID | undefined>
  readonly sourceState: (projectID: ProjectID) => ListSourceState
  readonly list: (projectID: ProjectID) => ReadonlyArray<ProjectFileListItem>
}) {
  const state = createMemo<ProjectFileListState>(() => {
    const projectID = options.projectID()
    if (!projectID) return { status: "no-project" }
    return deriveListState(options.sourceState(projectID), options.list(projectID))
  })

  return { state }
}
