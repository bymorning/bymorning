import type { Project } from "@bymorning/schema/project"
import type { Workspace } from "@bymorning/schema/workspace"

/** Identity of the Workspace and optional Project that loaded a plugin instance. */
export interface Location {
  readonly workspaceID: Workspace.ID
  readonly projectID?: Project.ID
}
