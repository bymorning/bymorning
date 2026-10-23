export * as ConfigCodeInterpreterPlugin from "./code-interpreter.js"

import { define } from "@bymorning/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { Config } from "../../config.js"
import { CodeInterpreter } from "../../code-interpreter.js"

/** Projects persisted Code Interpreter selection after implementation registrations. */
export const Plugin = define({
  id: "bymorning.config.code-interpreter",
  effect: Effect.fn(function* (context) {
    const config = yield* Config.Service
    const interpreter = yield* CodeInterpreter.Service
    let info = yield* config.get
    yield* config.changes().pipe(Stream.runForEach(() => Effect.gen(function* () {
      info = yield* config.get
      yield* interpreter.reload()
    })), Effect.forkScoped({ startImmediately: true }))
    info = yield* config.get
    yield* interpreter.transform((editor) => {
      if (info.code_interpreter !== undefined) editor.default.set(info.code_interpreter.implementation)
    })
  }),
})
