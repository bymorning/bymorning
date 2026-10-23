export * as ConfigMcpPlugin from "./mcp.js"

import { define } from "@bymorning/plugin/effect/plugin"
import type { Plugin as PluginDefinition } from "@bymorning/plugin/effect/plugin"
import { Effect, Scope, Stream } from "effect"
import { Config } from "../../config.js"
import { Mcp } from "../../mcp.js"

/** Config-driven MCP source. Configuration is admitted directly into Mcp. */
export const Plugin = define({
  id: "bymorning.config.mcp",
  effect: () =>
    Effect.gen(function* () {
      const config = yield* Config.Service
      const mcp = yield* Mcp.Service
      let info = yield* config.get
      yield* config.changes().pipe(
        Stream.runForEach(() =>
          Effect.gen(function* () {
            info = yield* config.get
            yield* mcp.reload()
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      // Close the race between the first read and establishing the subscription.
      info = yield* config.get
      // One stable contribution: reload changes its captured configuration but
      // never moves it after later plugin registrations or clears their servers.
      yield* mcp.transform((editor) => {
        for (const [name, server] of Object.entries(info.mcp?.servers ?? {})) editor.set(name, server)
        for (const [name, activation] of Object.entries(info.mcp?.activation ?? {}))
          editor.update(name, (server) => {
            server.enabled = activation === "enabled"
          })
      })
    }),
}) satisfies PluginDefinition<Config.Service | Mcp.Service | Scope.Scope>
