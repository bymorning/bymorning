import { Plugin } from "@bymorning/plugin/effect"
import { Effect } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { makePlugin } from "./gmail.js"
import { googleGmail } from "./google.js"

export { makePlugin } from "./gmail.js"

export default Plugin.define({
  id: googleGmail.pluginID,
  effect: (context) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient
      yield* makePlugin(client).effect(context)
    }).pipe(Effect.provide(FetchHttpClient.layer)),
})
