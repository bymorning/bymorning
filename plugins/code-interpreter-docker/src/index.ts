import { Plugin } from "@bymorning/plugin/effect"
import { Effect, Schema } from "effect"
import { open } from "./execution.js"

const Options = Schema.Struct({ image: Schema.NonEmptyString })

export default Plugin.define({
  id: "docker",
  configuration: {
    title: "Docker Code Interpreter",
    fields: [
      {
        key: "image",
        type: "string",
        title: "Container image",
        required: true,
        default: "bymorning-code-interpreter:local",
      },
    ],
  },
  effect: (context) =>
    Effect.gen(function* () {
      const options = yield* Schema.decodeUnknownEffect(Options)(context.options).pipe(Effect.orDie)
      yield* context.codeInterpreter.transform((draft) => {
        draft.add({ id: "docker", name: "Docker", open: open(options) })
      })
    }),
})
