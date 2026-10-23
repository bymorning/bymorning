export {
  CurrentActor,
  CurrentReservation,
  GatewayApi,
  GatewayMiddleware,
  LLMGatewayGroup,
  McpGroup,
  SpendMiddleware,
} from "./contract.js"
export { CurrentActor as GatewayActor } from "./contract.js"
export { layer as spendMiddlewareLayer } from "./spend.js"

import { Layer } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { GatewayApi } from "./contract.js"
import { layer as llm } from "./llm-gateway/handler.js"
import { layer as tool } from "./tool-gateway/http.js"
import { ToolGateway } from "./tool-gateway.js"

/** Complete standalone Gateway route layer. */
export const layer = HttpApiBuilder.layer(GatewayApi).pipe(
  Layer.provide(Layer.mergeAll(llm, tool.pipe(Layer.provide(ToolGateway.layer)))),
)
export { layer as gatewayHandlers }
