import { Actor } from "@bymorning/core/actor"
import { Budget } from "@bymorning/core/budget"
import type { LLMGateway } from "@bymorning/schema/llm-gateway"
import { ServiceUnavailableError } from "@bymorning/protocol/errors"
import { Effect, Layer, Stream } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { CurrentActor, CurrentBudget, CurrentReservation, SpendMiddleware } from "./contract.js"
import { DeniedError } from "./llm-gateway/failure.js"
import { adapters } from "./llm-gateway/protocol.js"

/** Endpoint names are the contract; the caller format decides how a refusal is rendered. */
const protocolOf: Record<string, LLMGateway.Protocol> = {
  "llm-gateway.openaiChat": "openai-chat",
  "llm-gateway.openaiResponses": "openai-responses",
  "llm-gateway.anthropicMessages": "anthropic-messages",
  "llm-gateway.googleGenerate": "google-generate",
}

/**
 * Reserve spend for every Holder the authenticated Actor implies. The
 * reservation lives in the router's request Scope, which closes after the
 * response body completes, so an invocation that never observes usage releases
 * its hold only once the stream ends.
 */
export const layer = Layer.effect(
  SpendMiddleware,
  Effect.gen(function* () {
    const budget = yield* Budget.Service
    return SpendMiddleware.of((httpEffect, options) =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor
        const holders = Actor.holders(actor)
        const reservation = yield* budget.reserve(holders).pipe(
          Effect.catchTag("Budget.StoreError", () =>
            Effect.logError("Budget reservation failed").pipe(
              Effect.andThen(Effect.fail(new ServiceUnavailableError({ message: "Budget is unavailable" }))),
            ),
          ),
        )
        return yield* httpEffect.pipe(
          Effect.provideService(CurrentReservation, reservation),
          Effect.provideService(CurrentBudget, {
            reserve: (estimate) => budget.reserve(holders, estimate === undefined ? undefined : { estimate }),
          }),
        )
      }).pipe(
        Effect.catchTag("Budget.ExceededError", (error) =>
          Effect.succeed(
            refusal(protocolOf[options.endpoint.name] ?? "openai-chat", new DeniedError({ reason: "budget", retryAfter: error.retryAfter })),
          ),
        ),
      ),
    )
  }),
)

const refusal = (protocol: LLMGateway.Protocol, failure: DeniedError) => {
  const rendered = adapters[protocol].error(failure)
  return HttpServerResponse.stream(Stream.make(new TextEncoder().encode(JSON.stringify(rendered.body))), {
    status: rendered.status,
    headers: rendered.headers,
  })
}
