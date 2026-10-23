export * as ProvidersPlugin from "./providers.js"

import { Plugin } from "@bymorning/plugin/effect"
import type { GatewayRequest } from "@bymorning/plugin/effect"
import type { GatewayInvocation, SessionInvocation } from "@bymorning/plugin/effect/model"
import { ModelError } from "@bymorning/schema/plugin-model"
import { Effect } from "effect"
import { Config } from "../../config.js"

const denied = (provider: string) =>
  new ModelError({
    reason: "denied",
    message: `Provider ${provider} is not on the company allowlist.`,
  })

const providerOf = (model: string) => {
  const slash = model.indexOf("/")
  return slash <= 0 ? undefined : model.slice(0, slash)
}

/**
 * Workspace Provider allowlist from `Config.providers`.
 *
 * Omitted `providers` or omitted `allow` admits every Provider. An empty `allow`
 * admits none. Reads `Config.get` at hook time so later Config is visible without
 * re-registering.
 */
export const plugin = Plugin.define({
  id: "bymorning.config.providers",
  scope: "workspace",
  effect: (host) => Effect.gen(function* () {
    const config = yield* Config.Service
    const refuse = Effect.fn("Plugin.providers")(function* (provider: string) {
      const allow = (yield* config.get).providers?.allow
      if (allow === undefined) return
      if (allow.some((name) => name === provider)) return
      return yield* denied(provider)
    })
    const invoke = Effect.fn("Plugin.providers.invoke")(function* (input: SessionInvocation | GatewayInvocation) {
      yield* refuse(input.model.provider)
    })
    const request = Effect.fn("Plugin.providers.request")(function* (input: GatewayRequest) {
      const model = providerOf(input.model)
      const requested = providerOf(input.requestedModel)
      if (model !== undefined) yield* refuse(model)
      if (requested !== undefined) yield* refuse(requested)
    })
    yield* host.session.hook("model.invoke", invoke)
    yield* host.gateway.hook("model.invoke", invoke)
    yield* host.gateway.hook("model.request", request)
  }),
})
