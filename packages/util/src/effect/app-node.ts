import { LayerNode } from "./layer-node.js"

export const tags = LayerNode.tags({
  workspace: ["global"],
  global: [],
})

export type GlobalGraph<A, E = never> = LayerNode.Graph<A, E, (typeof tags.values)["global"]>
export type WorkspaceGraph<A, E = never> = LayerNode.Graph<A, E, (typeof tags.values)["workspace"]>
/** Read-only composition handles. Use the Provider aliases where replacement authority is required. */
export type GlobalNode<A, E = never> = GlobalGraph<A, E>
export type WorkspaceNode<A, E = never> = WorkspaceGraph<A, E>
export type GlobalProvider<A, E = never> = LayerNode.Provider<A, E, (typeof tags.values)["global"]>
export type WorkspaceProvider<A, E = never> = LayerNode.Provider<A, E, (typeof tags.values)["workspace"]>

export const makeGlobalNode = tags.make("global")
export const makeWorkspaceNode = tags.make("workspace")

export * as Node from "./app-node.js"
