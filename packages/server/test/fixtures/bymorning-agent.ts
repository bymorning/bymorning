import { Plugin } from "@bymorning/plugin/effect"
import { Effect } from "effect"

export default Plugin.define({
  id: "project.agent.reviewer",
  effect: (context) =>
    Effect.asVoid(
      context.agent.transform((editor) => {
        editor.update("reviewer", (agent) =>
          Object.assign(agent, {
            instructions: "Review for correctness, regressions, and missing tests.",
            steps: 8,
          }),
        )
      }),
    ),
})
