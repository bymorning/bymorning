import { describe, expect, it } from "@effect/vitest"
import { Agent } from "@bymorning/schema/agent"
import { Config as ConfigSchema } from "@bymorning/schema/config"
import { ModelError } from "@bymorning/schema/plugin-model"
import type { GatewayInvocation, SessionInvocation } from "@bymorning/plugin/effect/model"
import type { WorkspaceContext } from "@bymorning/plugin/effect/plugin"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import { Tokens } from "@bymorning/schema/usage"
import { Workspace } from "@bymorning/schema/workspace"
import { Effect, Layer, Schema, Scope, Stream } from "effect"
import { Config } from "../src/config.js"
import { Limiter } from "../src/limiter.js"
import { Plugin } from "../src/plugin.js"
import { plugin as limiterPlugin } from "../src/plugin/internal/limiter.js"

const workspaceID = Workspace.ID.make("wrk_limit_enforcement_test")
const unused = () => Effect.die("unused")

const sessionEvent = {
  id: "attempt-1",
  workspaceID,
  sessionID: Session.ID.make("00000000-0000-4000-8000-000000000001"),
  agent: Agent.ID.make("build"),
  purpose: "assistant" as const,
  model: { provider: Provider.Bymorning, id: "gpt-5.6-sol" },
  publicModel: "bymorning/gpt-5.6-sol",
  stream: true,
} as const

const gatewayEvent = {
  id: "attempt-2",
  workspaceID,
  model: { provider: Provider.Bymorning, id: "gpt-5.6-sol" },
  publicModel: "bymorning/gpt-5.6-sol",
  stream: false,
  protocol: "openai-chat" as const,
} as const

const tokens = Tokens.make({ input: 3, output: 2, reasoning: 1, cacheRead: 7, cacheWrite: 8 })

const layers = (gateway: unknown) =>
  Effect.gen(function* () {
    const info = yield* Schema.decodeUnknownEffect(ConfigSchema.Info)({ gateway })
    const config = Config.Service.of({
      provider: { update: () => Effect.die("unused") },
      model: { put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
      get: Effect.succeed(info),
      update: unused,
      refresh: Effect.die("unused"),
      modelPolicy: { reconcile: unused, toggle: unused, setDefault: unused },
      mcp: { update: () => Effect.die("unused"), put: unused, remove: unused },
      plugin: { configure: unused },
      entries: unused,
      changes: () => Stream.empty,
    })
    return Layer.mergeAll(Plugin.Hooks.layer, Limiter.layer, Layer.succeed(Config.Service, config))
  })

/** Minimal Workspace host surface the built-in limit plugin consumes. */
const limitHost = (hooks: Plugin.Hooks.Interface): WorkspaceContext =>
  ({
    session: {
      hook: (
        name: "model.invoke",
        callback: (input: SessionInvocation) => Effect.Effect<void, ModelError, Scope.Scope>,
      ) => hooks.register("session", name, callback),
    },
    gateway: {
      hook: (
        name: "model.invoke",
        callback: (input: GatewayInvocation) => Effect.Effect<void, ModelError, Scope.Scope>,
      ) => hooks.register("gateway", name, callback),
    },
  }) as WorkspaceContext

/** Activate the real built-in limit plugin against the real limit authority. */
const activate = Effect.gen(function* () {
  const hooks = yield* Plugin.Hooks.Service
  yield* limiterPlugin.effect(limitHost(hooks))
  return hooks
})

const attempt = (domain: "session" | "gateway") =>
  Effect.gen(function* () {
    const hooks = yield* activate
    return yield* hooks.open(domain === "session" ? { domain, event: sessionEvent } : { domain, event: gatewayEvent })
  })

describe("built-in limit enforcement", () => {
  it.effect("refuses the second admission with a rate ModelError when the Workspace RPM cap is exhausted", () =>
    Effect.gen(function* () {
      const layer = yield* layers({ limits: { rpm: 1 } })
      const program = Effect.gen(function* () {
        const hooks = yield* activate
        // The first admission holds the single shared request allowance.
        yield* hooks.open({ domain: "session", event: sessionEvent })
        const error = yield* hooks.open({ domain: "gateway", event: gatewayEvent }).pipe(Effect.flip)
        expect(error).toBeInstanceOf(ModelError)
        expect(error).toMatchObject({ reason: "rate" })
      })
      yield* program.pipe(Effect.provide(layer))
    }).pipe(Effect.scoped),
  )

  it.effect("charges actual tokens without cache and still refuses over the TPM cap", () =>
    Effect.gen(function* () {
      const layer = yield* layers({ limits: { tpm: 10 } })
      const program = Effect.gen(function* () {
        const hooks = yield* activate
        const first = yield* hooks.open({ domain: "gateway", event: gatewayEvent })
        // 3+2+1 billable tokens fit the TPM cap; cache tokens must not count.
        yield* first.usage(tokens)
        const second = yield* hooks.open({ domain: "gateway", event: { ...gatewayEvent, id: "attempt-3" } })
        const error = yield* second.usage(tokens).pipe(Effect.flip)
        expect(error).toBeInstanceOf(ModelError)
        expect(error).toMatchObject({ reason: "rate" })
      })
      yield* program.pipe(Effect.provide(layer))
    }).pipe(Effect.scoped),
  )

  it.effect("refuses session and gateway admission with a model ModelError outside the Workspace allowlist", () =>
    Effect.gen(function* () {
      const layer = yield* layers({ models: ["bymorning/gpt-5.6-luna"] })
      for (const domain of ["session", "gateway"] as const) {
        const error = yield* attempt(domain).pipe(Effect.flip, Effect.provide(layer))
        expect(error).toBeInstanceOf(ModelError)
        expect(error).toMatchObject({ reason: "model" })
      }
    }).pipe(Effect.scoped),
  )
})
