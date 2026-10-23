export * as ToolGateway from "./tool-gateway.js"
export * as Member from "./tool-gateway/member.js"
export { UnavailableError } from "./tool-gateway/failure.js"
export * as Runtime from "./tool-gateway/runtime.js"

import { Context, Effect, Layer } from "effect"
import type { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { handle } from "./tool-gateway/handler.js"
import { Runtime } from "./tool-gateway/runtime.js"

export interface Interface {
  /** Handle one authenticated inbound MCP Streamable HTTP request. */
  readonly handle: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, never, import("./contract.js").CurrentActor>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/gateway/ToolGateway") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const runtime = yield* Runtime.Service
    return Service.of({ handle: (request) => handle(request).pipe(Effect.provideService(Runtime.Service, runtime)) })
  }),
)
