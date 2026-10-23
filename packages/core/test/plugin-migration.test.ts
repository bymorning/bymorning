import { describe, expect, it } from "@effect/vitest"
import { Agent } from "@bymorning/schema/agent"
import { Model } from "@bymorning/schema/model"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import { ID as MessageID } from "@bymorning/schema/message"
import { Workspace } from "@bymorning/schema/workspace"
import { ConfigProvider, Effect, Exit, Layer, Scope } from "effect"
import { Storage } from "../src/storage.js"
import { PluginHooks } from "../src/plugin/hooks.js"
import { archive, load } from "../src/plugin/migration.js"
import { workspace } from "../src/plugin/host.js"
import { Catalog } from "../src/catalog.js"

const workspaceID = Workspace.ID.make("wrk_migration")
const sessionID = Session.ID.make("00000000-0000-4000-8000-000000000901")
const messageID = MessageID.make("00000000-0000-4000-8000-000000000902")
const requested = Model.Ref.make({ provider: Provider.Name.make("openai"), id: "original" })
const agent = Agent.ID.make("build")
const storageLayer = Storage.layer({ configure: (editor) => {
  const provider = Storage.memory()
  editor.add(provider)
  editor.default.set(provider.id)
} })
const dependencies = Layer.merge(storageLayer, PluginHooks.layer)
const catalog = Catalog.Service.of({
  transform: () => Effect.die("unused Catalog transform"), reload: () => Effect.void,
  provider: { get: () => Effect.succeed(undefined), all: () => Effect.succeed([]), available: () => Effect.succeed([]), directory: () => Effect.succeed([]), update: () => Effect.die("unused Catalog mutation") },
  model: {
    get: () => Effect.succeed(undefined), all: () => Effect.succeed([]), available: () => Effect.succeed([]), visible: () => Effect.succeed([]), default: () => Effect.succeed(undefined),
    requireAvailable: () => Effect.die("unused Catalog resolution"), requireExecution: () => Effect.die("unused Catalog execution"), toggle: () => Effect.die("unused Catalog mutation"), setDefault: () => Effect.die("unused Catalog mutation"), create: () => Effect.die("unused Catalog mutation"), update: () => Effect.die("unused Catalog mutation"), delete: () => Effect.die("unused Catalog mutation"),
  },
})
const activate = Effect.fn("Test.activate")(function* (options: Record<string, unknown> = {}) {
  const storage = yield* Storage.Service
  const hooks = yield* PluginHooks.Service
  const loaded = yield* load(storage, workspaceID)
  yield* loaded.plugin.effect(workspace({ scope: "workspace", app: { name: "test", version: "test", channel: "test" }, workspaceID, catalog, shellHooks: hooks, storage }, loaded.plugin.id, options))
  return loaded
})

describe("retained definition migration", () => {
  it.effect("archives exact JSON and every suppression before compiling; snapshots remain retrievable", () => Effect.gen(function* () {
    const storage = yield* Storage.Service
    const retained = storage.scope({ workspaceID, pluginID: "core.policy.managed" })
    const original = { id: "invalid", name: "retained", unexpected: { authorization: "test-only-private-header" }, rules: [] }
    yield* retained.set("policy/invalid", original)
    yield* retained.set("suppressed/bymorning.model-routing:openai/a", true)
    const first = yield* archive(storage, workspaceID)
    expect(first.report.map((entry) => entry.status)).toEqual(["invalid", "suppressed"])
    expect(first.definitions[0]?.value).toEqual(original)
    yield* retained.set("policy/second", { id: "second", name: "second", enabled: false, rules: [] })
    const second = yield* archive(storage, workspaceID)
    expect(second.key).not.toBe(first.key)
    expect(yield* retained.get(first.key)).toEqual(first)
    expect(yield* retained.get("policy/invalid")).toEqual(original)
    expect((yield* archive(storage, workspaceID)).key).toBe(second.key)
  }).pipe(Effect.provide(dependencies)))

  it.effect("preserves prompt/context transforms, route precedence and private endpoint headers", () => Effect.scoped(Effect.gen(function* () {
    const storage = yield* Storage.Service
    const hooks = yield* PluginHooks.Service
    yield* storage.scope({ workspaceID, pluginID: "core.policy.managed" }).set("policy/one", {
      id: "one", name: "One", rules: [
        { type: "prompt", match: { pattern: "secret" }, replacement: "redacted" },
        { type: "instruction", model: "openai/final", text: "Company instruction" },
        { type: "route", action: "model.request", resource: "openai/original", target: "openai/first" },
        { type: "route", action: "model.request", resource: "openai/original", target: "openai/final" },
        { type: "endpoint", model: "openai/final", baseURL: "https://example.test", headers: { authorization: "test-only-private-header", "x-env": { env: "MIGRATION_HEADER" } } },
      ],
    })
    const loaded = yield* activate()
    expect(JSON.stringify(loaded.plugin.configuration)).not.toContain("test-only-private-header")
    const prompt = yield* hooks.trigger("session", "prompt", { sessionID, messageID, prompt: { text: "secret secret" } })
    expect(prompt.prompt.text).toBe("redacted redacted")
    const routed = yield* hooks.trigger("session", "model.request", { sessionID, agent, purpose: "assistant", requestedModel: requested, model: requested, headers: {} })
    expect(routed.model.id).toBe("final")
    expect(routed.headers).toEqual({ authorization: "test-only-private-header", "x-env": "available" })
    const context = yield* hooks.trigger("session", "context", { sessionID, agent, requestedModel: requested, model: routed.model, system: [], messages: [], tools: {} })
    expect(JSON.stringify(context.system)).toContain("Company instruction")
    expect(hooks.has("gateway", "model.request")).toBe(false)
  })).pipe(Effect.provide(dependencies), Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({ MIGRATION_HEADER: "available" })) ))

  it.effect("preserves last-match admission across definitions and disposes it with activation", () => Effect.scoped(Effect.gen(function* () {
    const storage = yield* Storage.Service
    const hooks = yield* PluginHooks.Service
    const retained = storage.scope({ workspaceID, pluginID: "core.policy.managed" })
    yield* retained.set("policy/a", { id: "a", name: "Deny", rules: [{ type: "guardrail", action: "model.use", resource: "*", effect: "deny" }] })
    yield* retained.set("policy/b", { id: "b", name: "Allow one", rules: [{ type: "guardrail", action: "model.use", resource: "openai/allowed", effect: "allow" }] })
    const scope = yield* Scope.make()
    yield* activate().pipe(Effect.provideService(Scope.Scope, scope))
    const event = { id: "attempt", workspaceID, sessionID, agent, purpose: "assistant" as const, model: requested, publicModel: requested.id, stream: false }
    const denied = yield* Effect.scoped(hooks.open({ domain: "session", event })).pipe(Effect.flip)
    expect(denied.reason).toBe("denied")
    yield* Effect.scoped(hooks.open({ domain: "session", event: { ...event, model: { ...requested, id: "allowed" } } }))
    yield* Scope.close(scope, Exit.void)
    expect(hooks.has("session", "model.invoke")).toBe(false)
  })).pipe(Effect.provide(dependencies)))

  it.effect("reports previously unwired kinds without claiming enforcement and rejects malformed data", () => Effect.scoped(Effect.gen(function* () {
    const storage = yield* Storage.Service
    const retained = storage.scope({ workspaceID, pluginID: "core.policy.managed" })
    yield* retained.set("policy/unwired", { id: "unwired", name: "Unwired", rules: [{ type: "tool.output", tool: "*", match: { pattern: "secret" }, replacement: "redacted" }, { type: "escalate", tool: "*", target: "openai/larger" }] })
    const loaded = yield* activate()
    expect(loaded.report.report[0]?.rules.map((rule) => rule.status)).toEqual(["unwired", "unwired"])
    yield* retained.set("policy/broken", { retained: true })
    expect(Exit.isFailure(yield* activate().pipe(Effect.exit))).toBe(true)
    expect((yield* archive(storage, workspaceID)).definitions).toHaveLength(2)
  })).pipe(Effect.provide(dependencies)))
})
