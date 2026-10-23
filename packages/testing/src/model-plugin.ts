import { define } from "@bymorning/plugin/effect/plugin"
import { Effect, Schema } from "effect"

/** Route all scenario inference through the real request pipeline to the scripted transport. */
export default define({
  id: "test.model",
  effect: Effect.fn("TestModel.setup")(function* (context) {
    const endpoint = yield* Schema.decodeUnknownEffect(Schema.String)(context.options.endpoint).pipe(Effect.orDie)
    yield* context.session.hook("model.request", (input) =>
      Effect.sync(() => {
        input.baseURL = endpoint
        input.headers["x-bm-test-session"] = input.sessionID
        input.headers["x-bm-test-purpose"] = input.purpose
      }),
    )
  }),
})
