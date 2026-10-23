import { Plugin } from "@bymorning/plugin/effect"
import { Effect, Schema } from "effect"
import { make } from "./execution.js"

const Options = Schema.Struct({ identifier: Schema.NonEmptyString, region: Schema.optionalKey(Schema.String) })

export default Plugin.define({
  id: "agentcore",
  configuration: {
    title: "AWS AgentCore Code Interpreter",
    fields: [
      { key: "identifier", type: "string", title: "Code Interpreter resource ID", required: true },
      { key: "region", type: "string", title: "AWS region" },
    ],
  },
  effect: (context) =>
    Effect.gen(function* () {
      const options = yield* Schema.decodeUnknownEffect(Options)(context.options).pipe(Effect.orDie)
      yield* context.codeInterpreter.transform((draft) => {
        draft.add({
          id: "agentcore",
          name: "AWS AgentCore",
          open: make(options.identifier, options.region || undefined),
        })
      })
    }),
})
