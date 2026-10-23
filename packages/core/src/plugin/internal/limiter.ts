export * as LimiterPlugin from "./limiter.js"

import { Plugin } from "@bymorning/plugin/effect"
import type { GatewayInvocation, SessionInvocation } from "@bymorning/plugin/effect/model"
import { ModelError } from "@bymorning/schema/plugin-model"
import { Effect } from "effect"
import { Config } from "../../config.js"
import { Limiter } from "../../limiter.js"

const failure = (error: Limiter.LimitError | Limiter.StoreError) =>
  error._tag === "Limiter.StoreError"
    ? new ModelError({ reason: "unavailable", message: "Inference limit store is unavailable" })
    : new ModelError({
        reason: error.limit === "model" ? "model" : "rate",
        message: "Inference activity limit exceeded",
        ...(error.retryAfter === undefined ? {} : { retryAfter: error.retryAfter }),
      })

/** Workspace inference activity admission and actual-token accounting. */
export const plugin = Plugin.define({
  id: "bymorning.limiter",
  scope: "workspace",
  effect: (host) => Effect.gen(function* () {
    const limiter = yield* Limiter.Service
    const config = yield* Config.Service
    const invoke = Effect.fn("Plugin.limiter")(function* (input: SessionInvocation | GatewayInvocation) {
      yield* limiter.consume({ workspaceID: input.workspaceID, model: input.publicModel }).pipe(
        Effect.provideService(Config.Service, config), Effect.mapError(failure),
      )
      input.onUsage((tokens) => limiter.charge({
        workspaceID: input.workspaceID,
        tokens: tokens.input + tokens.output + tokens.reasoning,
      }).pipe(Effect.provideService(Config.Service, config), Effect.mapError(failure)))
    })
    yield* host.session.hook("model.invoke", invoke)
    yield* host.gateway.hook("model.invoke", invoke)
  }),
})
