import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { ServiceUnavailableError } from "../errors.js"

/** Account-scoped projection of the Workspaces available to a browser identity. */
export const WorkspaceGroup = HttpApiGroup.make("api.workspace")
  .add(
    HttpApiEndpoint.get("workspace.list", "/workspaces", {
      success: Schema.Array(WorkspaceAccess.Info),
      error: ServiceUnavailableError,
    }),
  )
  .prefix("/api")
