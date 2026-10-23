import type { ListState } from "../list-state"

export type ProjectFileListItem = {
  readonly path: string
}

export type ProjectFileListState = { readonly status: "no-project" } | ListState<ProjectFileListItem>
