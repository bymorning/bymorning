import { HttpApiBuilder } from "effect/unstable/httpapi"
import { GatewayApi } from "../contract.js"
import { ToolGateway } from "../tool-gateway.js"

export const layer = HttpApiBuilder.group(GatewayApi, "mcp", (handlers) =>
  handlers.handleRaw("mcp.request", ({ request }) => ToolGateway.Service.use((gateway) => gateway.handle(request))),
)
