import { describe, expect, it } from "@effect/vitest"
import type { Context as PluginContext } from "@bymorning/plugin/effect/plugin"
import type { Editor as MCPEditor } from "@bymorning/plugin/effect/mcp"
import type { ConfigMCP } from "@bymorning/schema/config/mcp"
import { ConfigMcpPlugin } from "../src/config/plugin/mcp.js"
import { Config } from "../src/config.js"
import { Mcp } from "../src/mcp.js"
import { State } from "../src/state.js"
import { Effect, Fiber, Layer, Option, Stream } from "effect"
import { TestClock } from "effect/testing"
import { configFixture, minimalConfig } from "./service-fixtures.js"

describe("ConfigMcpPlugin", () => {
  it.effect("delivers one committed change to each independent Config subscriber", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const config = yield* configFixture(minimalConfig)
        const context = yield* Layer.build(config.layer)
        const subscribe = Config.Service.use((service) => service.changes().pipe(Stream.take(1), Stream.runHead)).pipe(
          Effect.provide(context),
          Effect.forkScoped({ startImmediately: true }),
        )
        const first = yield* subscribe
        const second = yield* subscribe
        const next = { ...minimalConfig, mcp: { servers: { fixture: { type: "remote" as const, url: "https://fixture.example.com" } } } }
        yield* config.publish(next)
        expect(Option.isSome(yield* Fiber.join(first))).toBe(true)
        expect(Option.isSome(yield* Fiber.join(second))).toBe(true)
        const effective = yield* Config.Service.use((service) => service.get).pipe(Effect.provide(context))
        expect(effective.mcp).toEqual(next.mcp)
      }),
    ),
  )

  it.effect("projects Config changes without clearing other scoped registrations", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const first = { type: "remote" as const, url: "https://first.example.com" }
        const second = { type: "remote" as const, url: "https://second.example.com" }
        const other = { type: "remote" as const, url: "https://other.example.com" }
        const config = yield* configFixture({ ...minimalConfig, mcp: { servers: { first } } })
        const state = State.create<Map<string, ConfigMCP.Remote>, MCPEditor>({
          initial: () => new Map(),
          editor: (servers) => ({
            list: () => [...servers],
            get: (name) => servers.get(name),
            set: (name, server) => servers.set(name, server),
            update: (name, update) => {
              const server = servers.get(name)
              if (server !== undefined) update(server)
            },
            remove: (name) => {
              servers.delete(name)
            },
          }),
        })
        yield* state.transform((editor) => editor.set("other", other))
        const mcp = Mcp.Service.of({
          transform: state.transform,
          reload: state.reload,
          servers: () => Effect.die(new Error("unused")),
          instructions: () => Effect.die(new Error("unused")),
          authorize: () => Effect.die("unused"),
          connect: () => Effect.die(new Error("unused")),
          disconnect: () => Effect.die(new Error("unused")),
          test: () => Effect.die(new Error("unused")),
          tools: () => Effect.die(new Error("unused")),
          callTool: () => Effect.die(new Error("unused")),
        })

        // The plugin's activation contract ignores the host context; Config.Service and
        // Mcp.Service come from the environment.
        yield* ConfigMcpPlugin.Plugin.effect().pipe(
          Effect.provide(Layer.merge(config.layer, Layer.succeed(Mcp.Service, mcp))),
        )
        expect(state.get()).toEqual(
          new Map([
            ["other", other],
            ["first", first],
          ]),
        )

        yield* config.publish({ ...minimalConfig, mcp: { servers: { second } } })
        yield* TestClock.adjust("1 second")
        expect(state.get()).toEqual(
          new Map([
            ["other", other],
            ["second", second],
          ]),
        )

        yield* config.publish(minimalConfig)
        yield* TestClock.adjust("1 second")
        expect(state.get()).toEqual(new Map([["other", other]]))
      }),
    ),
  )

  it.effect("applies activation after server contributions and retains absent overrides", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const contributed = { type: "remote" as const, url: "https://plugin.example.com", disabled: true }
        const config = yield* configFixture({
          ...minimalConfig,
          mcp: { activation: { plugin: "enabled", future: "disabled" } },
        })
        const state = State.create<Map<string, ConfigMCP.Remote>, MCPEditor>({
          initial: () => new Map(),
          editor: (servers) => ({
            list: () => [...servers],
            get: (name) => servers.get(name),
            set: (name, server) => servers.set(name, structuredClone(server)),
            update: (name, update) => {
              const server = servers.get(name)
              if (server !== undefined) update(server)
            },
            remove: (name) => void servers.delete(name),
          }),
        })
        yield* state.transform((editor) => editor.set("plugin", contributed))
        const mcp = Mcp.Service.of({
          transform: state.transform,
          reload: state.reload,
          servers: () => Effect.die("unused"),
          instructions: () => Effect.die("unused"),
          authorize: () => Effect.die("unused"),
          connect: () => Effect.die("unused"),
          disconnect: () => Effect.die("unused"),
          test: () => Effect.die("unused"),
          tools: () => Effect.die("unused"),
          callTool: () => Effect.die("unused"),
        })
        yield* ConfigMcpPlugin.Plugin.effect().pipe(
          Effect.provide(Layer.merge(config.layer, Layer.succeed(Mcp.Service, mcp))),
        )
        expect(state.get().get("plugin")).toMatchObject({ enabled: true, disabled: true })
        expect(state.get().has("future")).toBe(false)
      }),
    ),
  )
})
