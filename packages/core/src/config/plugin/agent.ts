export * as ConfigAgentPlugin from "./agent.js"

import { define } from "@bymorning/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { Config } from "../../config.js"

/** Projects the persisted default Agent after ordinary plugin defaults. */
export const Plugin = define({
  id: "bymorning.config.agent",
  effect: Effect.fn(function* (context) {
    const config = yield* Config.Service
    let info = yield* config.get
    yield* config.changes().pipe(
      Stream.runForEach(() =>
        Effect.gen(function* () {
          info = yield* config.get
          yield* context.agent.reload()
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    // Close the race between the first read and establishing the subscription.
    info = yield* config.get
    yield* context.agent.transform((editor) => {
      if (info.default_agent !== undefined) editor.default(info.default_agent)
    })
  }),
})
