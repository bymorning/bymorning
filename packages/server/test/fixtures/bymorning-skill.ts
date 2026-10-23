import { Plugin, Skill } from "@bymorning/plugin/effect"
import { Effect } from "effect"

export default Plugin.define({
  id: "project.skill.review-work",
  effect: (context) =>
    Effect.asVoid(
      context.skill.transform((editor) => {
        editor.add(
          Skill.Info.make({
            id: Skill.ID.make("review-work"),
            name: "Review work",
            description: "Review the current work for correctness.",
            instructions: "Check correctness, regressions, and missing tests.",
          }),
        )
      }),
    ),
})
