import * as Workspace from "@bymorning/schema/workspace"
import { Layer } from "effect"
import { WorkspaceMap } from "../src/workspace-map.js"

/** Genuine LayerMap fixture for tests that do not exercise durable startup recovery. */
export const workspaceMap = (services: (workspaceID: Workspace.ID) => Layer.Layer<WorkspaceMap.Capabilities>) =>
  WorkspaceMap.layerFromFactory({ services: (owner) => services(owner.workspaceID) })
