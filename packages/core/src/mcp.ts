/** Remote Model Context Protocol capability. */
export * as Mcp from "./mcp.js"
export { Service, layer, node, workspaceNodes, make, identity } from "./mcp/index.js"
export { Plugin } from "./config/plugin/mcp.js"
export type { Dependencies, Editor, Status, Server, RemoteTool, ToolResult, Interface } from "./mcp/index.js"
export { AuthorizationError, NotFoundError, ToolCallError } from "./mcp/index.js"
export { RequestError, NeedsAuthError } from "./mcp/client.js"
