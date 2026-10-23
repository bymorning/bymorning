export * as ConfigWebSearchPlugin from "./websearch.js"

import { define } from "@bymorning/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { Config } from "../../config.js"

/** Projects the persisted WebSearch selection after ordinary plugin defaults. */
export const Plugin = define({
  id: "bymorning.config.websearch",
  effect: Effect.fn(function* (context) {
    const config = yield* Config.Service
    let info = yield* config.get
    yield* config.changes().pipe(
      Stream.runForEach(() =>
        Effect.gen(function* () {
          info = yield* config.get
          yield* context.websearch.reload()
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    // Close the race between the first read and establishing the subscription.
    info = yield* config.get
    yield* context.websearch.transform((editor) => {
      const selection = info.websearch
      if (selection === false) editor.default.set(false)
      if (selection) editor.default.set(selection.provider)
    })
  }),
})
