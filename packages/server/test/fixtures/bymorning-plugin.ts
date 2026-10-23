import { Plugin } from "@bymorning/plugin/effect"
import { Effect } from "effect"

export default Plugin.define({
  id: "project.example",
  effect: () => Effect.void,
})
