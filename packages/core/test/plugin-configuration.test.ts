import { describe, expect, it } from "@effect/vitest"
import { Config as ConfigSchema } from "@bymorning/schema/config"
import { Form } from "@bymorning/schema/form"
import { Plugin as PluginSchema } from "@bymorning/schema/plugin"
import { Cause, Effect, Exit, Layer, Ref, Schema, Stream } from "effect"
import { Config } from "../src/config.js"
import { Plugin } from "../src/plugin.js"
import { PluginConfiguration } from "../src/plugin/configuration.js"
import { PluginSupervisor } from "../src/plugin/supervisor-service.js"

const pluginID = PluginSchema.ID.make("builtin.configurable")
const configuration: PluginSchema.Configuration = {
  title: "Configurable",
  fields: [{ key: "mode", type: "string", options: [{ value: "strict", label: "Strict" }] }],
  values: {},
  configured: false,
}
const initialPlugin: PluginSchema.Info = {
  id: pluginID,
  source: { type: "builtin" },
  status: "active",
  tui: false,
  configuration,
}
const initialConfig = Schema.decodeUnknownSync(ConfigSchema.Info)({})

interface TestState {
  readonly config: Ref.Ref<ConfigSchema.Info>
  readonly inventory: Ref.Ref<PluginSchema.Info[]>
  readonly activations: Ref.Ref<number>
}

describe("PluginConfiguration", () => {
  it.effect("persists and activates validated plugin options", () =>
    Effect.gen(function* () {
      const state = yield* makeState()
      const configured = yield* PluginConfiguration.configure(pluginID, { mode: "strict" }).pipe(
        Effect.provide(testLayer(state, "success")),
      )

      expect(configured).toMatchObject({ status: "active", configuration: { values: { mode: "strict" } } })
      expect((yield* Ref.get(state.config)).plugins).toEqual([
        { package: "builtin.configurable", options: { mode: "strict" } },
      ])
    }),
  )

  it.effect("normalizes defaults into persisted and activated values", () =>
    Effect.gen(function* () {
      const state = yield* makeState({
        ...initialPlugin,
        configuration: {
          ...configuration,
          fields: [{ key: "enabled", type: "boolean", default: true }],
        },
      })
      const configured = yield* PluginConfiguration.configure(pluginID, {}).pipe(
        Effect.provide(testLayer(state, "success")),
      )

      expect(configured).toMatchObject({ configuration: { values: { enabled: true } } })
      expect((yield* Ref.get(state.config)).plugins).toEqual([
        { package: "builtin.configurable", options: { enabled: true } },
      ])
    }),
  )

  it.effect("rejects unknown submitted keys without persisting or reloading", () =>
    Effect.gen(function* () {
      const state = yield* makeState()
      const error = yield* PluginConfiguration.configure(pluginID, { mode: "strict", typo: true }).pipe(
        Effect.provide(testLayer(state, "success")),
        Effect.flip,
      )

      expect(error).toMatchObject({ _tag: "PluginConfiguration.InvalidError", message: "Unknown form field: typo" })
      expect((yield* Ref.get(state.config)).plugins).toBeUndefined()
      expect(yield* Ref.get(state.activations)).toBe(0)
      expect(yield* Ref.get(state.inventory)).toEqual([initialPlugin])
    }),
  )

  it.effect("rolls persisted options back when activation fails", () =>
    Effect.gen(function* () {
      const state = yield* makeState()
      const exit = yield* PluginConfiguration.configure(pluginID, { mode: "strict" }).pipe(
        Effect.provide(testLayer(state, "failure")),
        Effect.exit,
      )

      expect(exit._tag).toBe("Failure")
      expect((yield* Ref.get(state.config)).plugins).toBeUndefined()
    }),
  )

  it.effect("rolls back when inventory does not reflect the submitted configuration", () =>
    Effect.gen(function* () {
      const state = yield* makeState()
      const exit = yield* PluginConfiguration.configure(pluginID, { mode: "strict" }).pipe(
        Effect.provide(testLayer(state, "stale")),
        Effect.exit,
      )

      expect(exit._tag).toBe("Failure")
      expect((yield* Ref.get(state.config)).plugins).toBeUndefined()
    }),
  )

  it.effect("rejects dangling option-set references before activation", () =>
    Effect.gen(function* () {
      const state = yield* makeState({
        ...initialPlugin,
        configuration: {
          ...configuration,
          fields: [{ key: "mode", type: "string", optionsKey: "modes" }],
        },
      })
      const exit = yield* PluginConfiguration.configure(pluginID, {}).pipe(
        Effect.provide(testLayer(state, "success")),
        Effect.exit,
      )

      if (Exit.isSuccess(exit)) throw new Error("Expected invalid configuration")
      expect(Cause.pretty(exit.cause)).toContain("Missing option set: modes")
      expect(yield* Ref.get(state.activations)).toBe(0)
    }),
  )

  it.effect("rejects values absent from a referenced option set", () =>
    Effect.gen(function* () {
      const state = yield* makeState({
        ...initialPlugin,
        configuration: {
          ...configuration,
          fields: [{ key: "mode", type: "string", optionsKey: "modes" }],
          optionSets: { modes: [{ value: "available", label: "Available" }] },
        },
      })
      const exit = yield* PluginConfiguration.configure(pluginID, { mode: "unavailable" }).pipe(
        Effect.provide(testLayer(state, "success")),
        Effect.exit,
      )

      if (Exit.isSuccess(exit)) throw new Error("Expected invalid configuration")
      expect(Cause.pretty(exit.cause)).toContain("Invalid option for form field: mode")
      expect(yield* Ref.get(state.activations)).toBe(0)
    }),
  )

  it.effect("rejects fields which declare inline and shared options", () =>
    Effect.gen(function* () {
      const state = yield* makeState({
        ...initialPlugin,
        configuration: {
          ...configuration,
          fields: [
            {
              key: "mode",
              type: "string",
              options: [{ value: "strict", label: "Strict" }],
              optionsKey: "modes",
            },
          ],
          optionSets: { modes: [{ value: "other", label: "Other" }] },
        },
      })
      const exit = yield* PluginConfiguration.configure(pluginID, {}).pipe(
        Effect.provide(testLayer(state, "success")),
        Effect.exit,
      )

      if (Exit.isSuccess(exit)) throw new Error("Expected invalid configuration")
      expect(Cause.pretty(exit.cause)).toContain("Form field cannot declare options and optionsKey: mode")
    }),
  )
})

const makeState = Effect.fnUntraced(function* (plugin: PluginSchema.Info = initialPlugin) {
  return {
    config: yield* Ref.make(initialConfig),
    inventory: yield* Ref.make<PluginSchema.Info[]>([plugin]),
    activations: yield* Ref.make(0),
  }
})

function testLayer(state: TestState, outcome: "success" | "failure" | "stale") {
  const config = Config.Service.of({
    provider: { update: () => Effect.die("unused") },
    model: { put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
    get: Ref.get(state.config),
    update: () => Effect.die("unused"),
    refresh: Effect.die("unused"),
    modelPolicy: {
      reconcile: () => Effect.die("unused"),
      toggle: () => Effect.die("unused"),
      setDefault: () => Effect.die("unused"),
    },
    mcp: { update: () => Effect.die("unused"), put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
    plugin: {
      configure: (_source, id, options) =>
        Ref.modify(state.config, (current) => {
          const submitted = [{ package: id, options }]
          return [
            {
              rollback: Ref.update(state.config, (latest) =>
                Schema.toEquivalence(ConfigSchema.Info)(latest, { ...current, plugins: submitted }) ? current : latest,
              ),
            },
            { ...current, plugins: submitted },
          ]
        }),
    },
    entries: () => Effect.succeed([]),
    changes: () => Stream.never,
  })
  const plugins = Plugin.Service.of({
    activate: () => Effect.die("unused"),
    list: () => Ref.get(state.inventory),
    close: () => Effect.void,
    awaitActivation: Effect.void,
    hold: () => Effect.succeed(Effect.void),
  })
  const reloadAfter: PluginSupervisor.Interface["reloadAfter"] = (mutation) =>
    Effect.gen(function* () {
      const result = yield* mutation
      const activation = yield* Ref.getAndUpdate(state.activations, (count) => count + 1)
      if (outcome === "failure" && activation === 0)
        return yield* new PluginSupervisor.ActivationError({ cause: "activation failed" })
      const options = (yield* Ref.get(state.config)).plugins?.at(-1)
      if (typeof options !== "string" && options !== undefined) {
        const values = yield* Schema.decodeUnknownEffect(Form.Answer)(options.options).pipe(Effect.orDie)
        const current = (yield* Ref.get(state.inventory))[0]
        if (current?.configuration === undefined) return yield* Effect.die("Expected configurable plugin")
        yield* Ref.set(state.inventory, [
          {
            ...current,
            configuration: {
              ...current.configuration,
              values: outcome === "stale" ? {} : values,
              configured: true,
            },
          },
        ])
      }
      return result
    })
  return Layer.mergeAll(
    Layer.succeed(Config.Service, config),
    Layer.succeed(Plugin.Service, plugins),
    Layer.succeed(
      PluginSupervisor.Service,
      PluginSupervisor.Service.of({ awaitActivation: Effect.void, reload: reloadAfter(Effect.void), reloadAfter }),
    ),
  )
}
