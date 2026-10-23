import { Effect, Stream } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { CurrentActor, CurrentBudget, CurrentReservation, GatewayApi, principal } from "../contract.js"
import { LLMGateway } from "../llm-gateway.js"

export const layer = HttpApiBuilder.group(GatewayApi, "llm-gateway", (handlers) =>
  handlers
    .handleRaw("llm-gateway.models", () => list("openai-chat"))
    .handleRaw("llm-gateway.anthropicModels", () => list("anthropic-messages"))
    .handleRaw("llm-gateway.openaiChat", ({ request }) => invoke("openai-chat", request))
    .handleRaw("llm-gateway.openaiResponses", ({ request }) => invoke("openai-responses", request))
    .handleRaw("llm-gateway.anthropicMessages", ({ request }) => invoke("anthropic-messages", request))
    .handleRaw("llm-gateway.googleGenerate", ({ request }) => invoke("google-generate", request)),
)

const list = Effect.fn("LLMGatewayHandler.list")(function* (protocol: LLMGateway.Protocol) {
  const gateway = yield* LLMGateway.Service
  const actor = yield* CurrentActor
  return respond(yield* gateway.list({ protocol, workspaceID: actor.properties.workspaceID }))
})

const invoke = Effect.fn("LLMGatewayHandler.invoke")(function* (
  protocol: LLMGateway.Protocol,
  request: HttpServerRequest.HttpServerRequest,
) {
  const gateway = yield* LLMGateway.Service
  const actor = yield* CurrentActor
  const reservation = yield* CurrentReservation
  const budget = yield* CurrentBudget
  return respond(
    yield* gateway.invoke({
      protocol,
      request,
      workspaceID: actor.properties.workspaceID,
      // Usage accounting is attributed to the authenticated caller principal.
      principal: principal(actor),
      // Settlement failure after a committed Provider reply is an accounting
      // defect, never a caller-facing error.
      settle: (amount) => reservation.settle(amount).pipe(Effect.orDie),
      reserve: budget.reserve,
    }),
  )
})

const respond = (reply: LLMGateway.Reply) =>
  HttpServerResponse.stream(reply.body.pipe(Stream.orDie), { status: reply.status, headers: reply.headers })
