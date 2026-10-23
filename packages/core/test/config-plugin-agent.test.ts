import { describe, expect, it } from "@effect/vitest"
import type { Context as PluginContext } from "@bymorning/plugin/effect/plugin"
import type { AgentEditor } from "@bymorning/plugin/effect/agent"
import { Agent } from "@bymorning/schema/agent"
import { ConfigAgentPlugin } from "../src/config/plugin/agent.js"
import { Config } from "../src/config.js"
import { State } from "../src/state.js"
import { Effect, Stream } from "effect"
import { TestClock } from "effect/testing"
import { configFixture, configService, minimalConfig } from "./service-fixtures.js"

describe("ConfigAgentPlugin", () => {
  it.effect("projects Config changes and falls back to the plugin default when removed", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const contributedID = "contributed"
        const config = yield* configFixture({ ...minimalConfig, default_agent: Agent.ID.make("configured") })
        const state = State.create<{ default: string | undefined }, AgentEditor>({
          initial: () => ({ default: undefined }),
          editor: (data) => ({
            list: () => [],
            get: () => undefined,
            default: (id) => {
              data.default = id
            },
            update: () => {},
            remove: () => {},
          }),
        })
        // Registered before the config projection, like ordinary plugin default contributions.
        yield* state.transform((editor) => editor.default(contributedID))
        const context = {
          agent: {
            transform: state.transform,
            reload: state.reload,
          },
        } as unknown as PluginContext

        yield* ConfigAgentPlugin.Plugin.effect(context).pipe(Effect.provide(config.layer))
        expect(state.get().default).toBe(Agent.ID.make("configured"))

        yield* config.publish({ ...minimalConfig, default_agent: Agent.ID.make("changed") })
        yield* TestClock.adjust("1 second")
        expect(state.get().default).toBe(Agent.ID.make("changed"))

        yield* config.publish(minimalConfig)
        yield* TestClock.adjust("1 second")
        expect(state.get().default).toBe(contributedID)
      }),
    ),
  )

  it.effect("re-reads Config after subscribing so the first projection is not stale", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const stale = { ...minimalConfig, default_agent: Agent.ID.make("stale") }
        const fresh = { ...minimalConfig, default_agent: Agent.ID.make("fresh") }
        // A commit lands just before subscription; its event is not replayed.
        let current = stale
        const config = Config.Service.of({
          ...configService(stale),
          get: Effect.sync(() => current),
          changes: () =>
            Stream.unwrap(
              Effect.sync(() => {
                current = fresh
                return Stream.never
              }),
            ),
        })
        const state = State.create<{ default: string | undefined }, AgentEditor>({
          initial: () => ({ default: undefined }),
          editor: (data) => ({
            list: () => [],
            get: () => undefined,
            default: (id) => {
              data.default = id
            },
            update: () => {},
            remove: () => {},
          }),
        })
        const context = {
          agent: {
            transform: state.transform,
            reload: state.reload,
          },
        } as unknown as PluginContext

        yield* ConfigAgentPlugin.Plugin.effect(context).pipe(Effect.provideService(Config.Service, config))
        expect(state.get().default).toBe(Agent.ID.make("fresh"))
      }),
    ),
  )
})
