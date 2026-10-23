export * as OutboundMCP from "./outbound-mcp.js"

import { define, inventory } from "./event.js"

const StatusChanged = define("mcp.status.changed", {})
const ToolsChanged = define("mcp.tools.changed", {})
export const Event = { StatusChanged, ToolsChanged, Definitions: inventory(StatusChanged, ToolsChanged) }
