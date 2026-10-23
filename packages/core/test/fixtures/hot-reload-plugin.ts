import { Plugin } from "@bymorning/plugin/effect"
import { Effect } from "effect"

const revision = "v1"

export default Plugin.define({
  id: "demo.same-pid",
  effect: (context) =>
    Effect.gen(function* () {
      yield* context.integration.transform((editor) => {
        editor.update("same-pid-demo", (integration) => {
          integration.name = `Hot Reload ${revision} | pid ${process.pid}`
        })
        editor.method.update({ integrationID: "same-pid-demo", method: { type: "key" } })
      })
      yield* Effect.logInfo("demo.same-pid activated", { revision, pid: process.pid })
      yield* Effect.addFinalizer(() => Effect.logInfo("demo.same-pid scope cleaned up", { revision, pid: process.pid }))
    }),
})
