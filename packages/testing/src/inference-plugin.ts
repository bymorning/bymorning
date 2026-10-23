import { Plugin } from "@bymorning/plugin"
import type { GatewayInvocation, SessionInvocation } from "@bymorning/plugin/promise/model"
import { ModelError } from "@bymorning/schema/plugin-model"
import { Model } from "@bymorning/schema/model"
import { Provider } from "@bymorning/schema/provider"
import { Schema } from "effect"
import type { Event } from "./scenario/plugin.js"

const Options = Schema.Struct({
  endpoint: Schema.String,
  generation: Schema.optionalKey(Schema.Finite),
  nativeAPI: Schema.optionalKey(Provider.API),
  route: Schema.optionalKey(Model.Ref),
  deny: Schema.optionalKey(Schema.Boolean),
  denyRequest: Schema.optionalKey(Schema.Boolean),
  failUsage: Schema.optionalKey(Schema.Boolean),
  invalidStream: Schema.optionalKey(Schema.Boolean),
})

/** Public Promise Plugin exercised through persisted configuration and the real loader. */
export default Plugin.define({
  id: "test.inference",
  scope: "workspace",
  async setup(context) {
    const options = Schema.decodeUnknownSync(Options)(context.options)
    const generation = options.generation ?? 1
    if (options.nativeAPI !== undefined) {
      const api = options.nativeAPI
      await context.catalog.transform((editor) => editor.provider.update(Provider.OpenCode, (provider) => { provider.api = api }))
    }
    const emit = async (event: Omit<Event, "generation" | "workspaceID">) => {
      const response = await fetch(options.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...event, generation, workspaceID: context.location.workspaceID }),
      })
      if (!response.ok) throw new Error("Plugin observer rejected an event")
    }
    await context.session.hook("model.request", async (input) => {
      await emit({ kind: "request", domain: "session", purpose: input.purpose, requestedModel: input.requestedModel.id })
      if (options.route !== undefined) input.model = options.route
    })
    await context.gateway.hook("model.request", async (input) => {
      await emit({ kind: "request", domain: "gateway", protocol: input.protocol, requestedModel: input.requestedModel })
      if (options.route !== undefined) input.model = `${options.route.provider}/${options.route.id}`
      if (options.invalidStream) input.body = { ...input.body, stream: !input.stream }
      if (options.denyRequest) return new ModelError({ reason: "denied", message: "Fixture request refusal" })
    })
    const invoke = async (domain: "session" | "gateway", input: SessionInvocation | GatewayInvocation) => {
      const facts = {
        id: input.id,
        domain,
        model: input.model,
        publicModel: input.publicModel,
        stream: input.stream,
        ...("sessionID" in input ? { sessionID: input.sessionID, purpose: input.purpose } : { protocol: input.protocol }),
      }
      input.onClose(() => emit({ ...facts, kind: "close", observer: 1 }))
      input.onClose(() => emit({ ...facts, kind: "close", observer: 2 }))
      input.onUsage(async (tokens) => {
        await emit({ ...facts, kind: "usage", observer: 1, tokens, frozen: Object.isFrozen(tokens) })
        if (options.failUsage) return new ModelError({ reason: "rate", message: "Fixture observer refusal" })
      })
      input.onUsage((tokens) => emit({ ...facts, kind: "usage", observer: 2, tokens, frozen: Object.isFrozen(tokens) }))
      await emit({
        ...facts,
        kind: "open",
        frozen: Object.isFrozen(input.model),
        caller: "actor" in input || "userID" in input || "accountID" in input,
      })
      if (options.deny) return new ModelError({ reason: "denied", message: "Fixture admission refusal" })
    }
    await context.session.hook("model.invoke", (input) => invoke("session", input))
    await context.gateway.hook("model.invoke", (input) => invoke("gateway", input))
    await emit({ kind: "activate" })
    return () => emit({ kind: "dispose" })
  },
})
