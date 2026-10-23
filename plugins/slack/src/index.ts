import { Plugin } from "@bymorning/plugin/effect"
import { Effect } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { makePlugin } from "./plugin.js"
import { slack } from "./slack.js"

export { makePlugin } from "./plugin.js"
export { slack } from "./slack.js"

export default Plugin.define({
  id: slack.pluginID,
  effect: (context) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient
      yield* makePlugin(client).effect(context)
    }).pipe(Effect.provide(FetchHttpClient.layer)),
})
