import { LayerNode } from "@bymorning/util/effect/layer-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { PluginHooks } from "../src/plugin/hooks.js"
import { Shell } from "../src/shell.js"
import { AppProcess } from "../src/util/process.js"

const dependencies = Layer.merge(
  PluginHooks.layer,
  LayerNode.compile(AppProcess.node),
)
const layer = Layer.merge(dependencies, Shell.layer.pipe(Layer.provide(dependencies)))

describe("Shell", () => {
  it.effect("applies create.before mutations before spawning", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const shell = yield* Shell.Service
      yield* hooks.register("shell", "create.before", (input) =>
        Effect.sync(() => {
          input.command = `printf '%s' "$PLUGIN_VALUE"`
          input.env.PLUGIN_VALUE = "hooked"
        }),
      )
      expect(yield* shell.run({ command: "false", cwd: process.cwd() })).toBe("hooked")
    }).pipe(Effect.scoped, Effect.provide(layer)),
  )
})
