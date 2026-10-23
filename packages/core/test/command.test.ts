import { LayerNode } from "@bymorning/util/effect/layer-node"
import { describe, expect, it } from "@effect/vitest"
import { Event } from "@bymorning/schema/event"
import { Bus } from "../src/bus.js"
import { Command } from "../src/command.js"
import { PluginHooks } from "../src/plugin/hooks.js"
import { Shell } from "../src/shell.js"
import { AppProcess } from "../src/util/process.js"
import { Effect, Layer, Stream } from "effect"

const bus = Layer.succeed(
  Bus.Service,
  Bus.Service.of({
    publish: ((definition: Event.Definition, data: unknown) =>
      Effect.succeed({ id: Event.ID.make(crypto.randomUUID()), created: Date.now(), type: definition.type, data })) as Bus.Interface["publish"],
        subscribe: (() => Effect.succeed(Stream.empty)) as Bus.Subscribe,
  }),
)
const shellDependencies = Layer.merge(
  PluginHooks.layer,
  LayerNode.compile(AppProcess.node),
)
const shell = Shell.layer.pipe(Layer.provide(shellDependencies))
const dependencies = Layer.mergeAll(bus, shell, shellDependencies)
const layer = Layer.merge(dependencies, Command.layer(process.cwd()).pipe(Layer.provide(dependencies)))

describe("Command", () => {
  it.effect("replays scoped definitions and evaluates arguments and shell interpolation", () =>
    Effect.gen(function* () {
      const commands = yield* Command.Service
      yield* commands.transform((editor) => {
        editor.update("greet", (command) => {
          command.template = "hello $1 $2"
        })
        editor.update("shell", (command) => {
          command.template = "value !`printf 42`"
        })
      })

      expect(yield* commands.evaluate({ name: "greet", arguments: 'one "two words" three' })).toEqual({
        text: "hello one two words three",
      })
      expect(yield* commands.evaluate({ name: "shell" })).toEqual({ text: "value 42" })
    }).pipe(Effect.scoped, Effect.provide(layer)),
  )
})
