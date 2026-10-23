import type { Actor } from "@bymorning/schema/actor"
import type { Budget } from "@bymorning/core/budget"
import type { Principal } from "@bymorning/schema/usage"
import { Context, type Effect, Schema, type Scope } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema } from "effect/unstable/httpapi"
import { ServiceUnavailableError, UnauthorizedError } from "@bymorning/protocol/errors"

export class CurrentActor extends Context.Service<CurrentActor, Actor.Caller>()("@bymorning/gateway/CurrentActor") {}

/** The Usage principal one authenticated caller Actor implies for Gateway accounting. */
export const principal = (actor: Actor.Caller): Principal =>
  actor.type === "user"
    ? { type: "user", userID: actor.properties.userID }
    : { type: "service_account", serviceAccountID: actor.properties.serviceAccountID }

/** Authenticate the Token into the caller Actor. */
export class GatewayMiddleware extends HttpApiMiddleware.Service<GatewayMiddleware, { provides: CurrentActor }>()(
  "@bymorning/gateway/GatewayMiddleware",
  { error: [UnauthorizedError, ServiceUnavailableError] },
) {}

/** The Budget reservation the edge holds for one admitted invocation. */
export class CurrentReservation extends Context.Service<CurrentReservation, Budget.Reservation>()(
  "@bymorning/gateway/CurrentReservation",
) {}

/**
 * Reserve additional spend for the same Holders within the admitted invocation, such as a Routing
 * judge inference. Each reservation is scoped and settled independently of the invocation's own.
 */
export interface Reserve {
  readonly reserve: (estimate?: number) => Effect.Effect<Budget.Reservation, unknown, Scope.Scope>
}

/** Additional Budget reservations for the Holders of one admitted invocation. */
export class CurrentBudget extends Context.Service<CurrentBudget, Reserve>()("@bymorning/gateway/CurrentBudget") {}

/**
 * Reserve spend for the Holders the authenticated Actor implies before the
 * LLM Gateway domain runs. Refusals are rendered in the caller's native envelope.
 */
export class SpendMiddleware extends HttpApiMiddleware.Service<
  SpendMiddleware,
  { provides: CurrentReservation | CurrentBudget; requires: CurrentActor }
>()("@bymorning/gateway/SpendMiddleware", { error: [ServiceUnavailableError] }) {}

const Empty = HttpApiSchema.Empty(200)

export const LLMGatewayGroup = HttpApiGroup.make("llm-gateway")
  .add(HttpApiEndpoint.get("llm-gateway.models", "/inference/openai/v1/models", { success: Empty }))
  .add(HttpApiEndpoint.get("llm-gateway.anthropicModels", "/inference/anthropic/v1/models", { success: Empty }))
  .add(
    HttpApiEndpoint.post("llm-gateway.openaiChat", "/inference/openai/v1/chat/completions", {
      success: Empty,
    }).middleware(SpendMiddleware),
  )
  .add(
    HttpApiEndpoint.post("llm-gateway.openaiResponses", "/inference/openai/v1/responses", {
      success: Empty,
    }).middleware(SpendMiddleware),
  )
  .add(
    HttpApiEndpoint.post("llm-gateway.anthropicMessages", "/inference/anthropic/v1/messages", {
      success: Empty,
    }).middleware(SpendMiddleware),
  )
  .add(
    HttpApiEndpoint.post("llm-gateway.googleGenerate", "/inference/google/v1beta/models/:action", {
      success: Empty,
    }).middleware(SpendMiddleware),
  )
  .middleware(GatewayMiddleware)

export const McpGroup = HttpApiGroup.make("mcp")
  .add(HttpApiEndpoint.post("mcp.request", "/mcp", { payload: Schema.Json, success: Schema.Json }))
  .middleware(GatewayMiddleware)

export class GatewayApi extends HttpApi.make("gateway").add(McpGroup).add(LLMGatewayGroup) {}
