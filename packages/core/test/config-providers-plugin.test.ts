import { describe, expect, it } from "@effect/vitest"
import { Agent } from "@bymorning/schema/agent"
import { Config as ConfigSchema } from "@bymorning/schema/config"
import { ModelError } from "@bymorning/schema/plugin-model"
import type { GatewayInvocation, SessionInvocation } from "@bymorning/plugin/effect/model"
import type { WorkspaceContext } from "@bymorning/plugin/effect/plugin"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import { Workspace } from "@bymorning/schema/workspace"
import { Effect, Ref, Schema, Scope, Stream } from "effect"
import { Config } from "../src/config.js"
import { PluginHooks } from "../src/plugin/hooks.js"
import { plugin } from "../src/plugin/internal/providers.js"

const workspaceID = Workspace.ID.make("wrk_config_providers_plugin")
const unused = () => Effect.die("unused")

const sessionEvent = (provider: string, id = "model") => ({
  id: "attempt-session",
  workspaceID,
  sessionID: Session.ID.make("00000000-0000-4000-8000-000000000001"),
  agent: Agent.ID.make("build"),
  purpose: "assistant" as const,
  model: { provider: Provider.Name.make(provider), id },
  publicModel: `${provider}/${id}`,
  stream: true,
})

const gatewayEvent = (provider: string, id = "model") => ({
  id: "attempt-gateway",
  workspaceID,
  model: { provider: Provider.Name.make(provider), id },
  publicModel: `${provider}/${id}`,
  stream: false,
  protocol: "openai-chat" as const,
})

const gatewayRequest = (model: string, requestedModel = model) => ({
  protocol: "openai-chat" as const,
  requestedModel,
  stream: false,
  model,
  body: { model },
})

const stub = (get: Effect.Effect<ConfigSchema.Info>) =>
  Config.Service.of({
    provider: { update: () => Effect.die("unused") },
    model: { put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
    get,
    update: unused,
    refresh: Effect.die("unused"),
    modelPolicy: { reconcile: unused, toggle: unused, setDefault: unused },
    mcp: { update: () => Effect.die("unused"), put: unused, remove: unused },
    plugin: { configure: unused },
    entries: unused,
    changes: () => Stream.empty,
  })

const host = (hooks: PluginHooks.Interface): WorkspaceContext =>
  ({
    session: {
      hook: (
        name: "model.invoke",
        callback: (input: SessionInvocation) => Effect.Effect<void, ModelError, Scope.Scope>,
      ) => hooks.register("session", name, callback),
    },
    gateway: {
      hook: (name: "model.invoke" | "model.request", callback: never) =>
        name === "model.invoke"
          ? hooks.register("gateway", "model.invoke", callback)
          : hooks.register("gateway", "model.request", callback),
    },
  }) as WorkspaceContext

const activate = (get: Effect.Effect<ConfigSchema.Info>) =>
  Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    yield* plugin.effect(host(hooks)).pipe(Effect.provideService(Config.Service, stub(get)))
    return hooks
  })

const activateWith = (info: ConfigSchema.Info) => activate(Effect.succeed(info))

const decode = (input: unknown): ConfigSchema.Info => Schema.decodeUnknownSync(ConfigSchema.Info)(input)

const denied = (error: unknown) => {
  expect(error).toBeInstanceOf(ModelError)
  expect(error).toMatchObject({ reason: "denied" })
}

describe("Config providers plugin", () => {
  it.effect("admits every Provider when providers is omitted", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const hooks = yield* activateWith(decode({}))
        yield* hooks.open({ domain: "session", event: sessionEvent("openai") })
        yield* hooks.open({ domain: "gateway", event: gatewayEvent("anthropic") })
        yield* hooks.trigger("gateway", "model.request", gatewayRequest("google/gemini"))
      }),
    ).pipe(Effect.provide(PluginHooks.layer)),
  )

  it.effect("denies every Provider when allow is empty", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const hooks = yield* activateWith(decode({ providers: { allow: [] } }))
        denied(yield* hooks.open({ domain: "session", event: sessionEvent("openai") }).pipe(Effect.flip))
        denied(yield* hooks.open({ domain: "gateway", event: gatewayEvent("anthropic") }).pipe(Effect.flip))
        denied(yield* hooks.trigger("gateway", "model.request", gatewayRequest("openai/gpt-5")).pipe(Effect.flip))
      }),
    ).pipe(Effect.provide(PluginHooks.layer)),
  )

  it.effect("admits listed Providers and denies others on Session and Gateway invoke", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const hooks = yield* activateWith(decode({ providers: { allow: ["anthropic", "openai"] } }))
        yield* hooks.open({ domain: "session", event: sessionEvent("openai") })
        yield* hooks.open({ domain: "gateway", event: gatewayEvent("anthropic") })
        denied(yield* hooks.open({ domain: "session", event: sessionEvent("google") }).pipe(Effect.flip))
        denied(yield* hooks.open({ domain: "gateway", event: gatewayEvent("google") }).pipe(Effect.flip))
      }),
    ).pipe(Effect.provide(PluginHooks.layer)),
  )

  it.effect("admits listed Providers and denies others on Gateway request string models", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const hooks = yield* activateWith(decode({ providers: { allow: ["anthropic", "openai"] } }))
        yield* hooks.trigger("gateway", "model.request", gatewayRequest("openai/gpt-5"))
        yield* hooks.trigger("gateway", "model.request", gatewayRequest("anthropic/claude"))
        denied(
          yield* hooks.trigger("gateway", "model.request", gatewayRequest("google/gemini")).pipe(Effect.flip),
        )
        denied(
          yield* hooks
            .trigger("gateway", "model.request", gatewayRequest("openai/gpt-5", "google/gemini"))
            .pipe(Effect.flip),
        )
      }),
    ).pipe(Effect.provide(PluginHooks.layer)),
  )

  it.effect("reads Config.get on each hook without re-registering", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const current = yield* Ref.make(decode({}))
        const hooks = yield* activate(Ref.get(current))
        yield* hooks.open({ domain: "session", event: sessionEvent("openai") })
        yield* hooks.trigger("gateway", "model.request", gatewayRequest("anthropic/claude"))
        yield* Ref.set(current, decode({ providers: { allow: ["anthropic"] } }))
        denied(yield* hooks.open({ domain: "session", event: sessionEvent("openai") }).pipe(Effect.flip))
        yield* hooks.open({ domain: "gateway", event: gatewayEvent("anthropic") })
        denied(
          yield* hooks.trigger("gateway", "model.request", gatewayRequest("openai/gpt-5")).pipe(Effect.flip),
        )
      }),
    ).pipe(Effect.provide(PluginHooks.layer)),
  )
})
