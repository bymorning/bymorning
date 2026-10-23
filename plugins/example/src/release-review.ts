import { Plugin } from "@bymorning/plugin"
import { Skill } from "@bymorning/schema/skill"

const review = Skill.Info.make({
  id: Skill.ID.make("release-review"),
  name: "Release review",
  description: "Produce a decision-ready release review with traceable evidence and rollback planning.",
  instructions: `# Release review

Use this workflow before promoting a change to a customer-facing environment.

1. Define the release boundary: version or commit, included changes, excluded changes, target environment, owners, planned window, and customer-facing intent. Flag any change whose deployed artifact cannot be tied to a reviewed revision.
2. Map each material change to evidence: requirement or incident, code review, automated test result, migration plan, security or privacy impact, observability change, and operator runbook. Mark missing evidence explicitly rather than inferring approval.
3. Assess runtime compatibility. Check API and event contracts, database migration order and reversibility, configuration defaults, feature-flag state, background jobs, permissions, provider dependencies, and capacity-sensitive paths.
4. Specify release controls: staged audience, success metrics, error and latency guardrails, monitoring links, owner on call, decision checkpoints, and a time-bounded observation period. Use measurable thresholds whenever they exist.
5. Specify rollback before approval: trigger, decision owner, exact rollback action, expected duration, data consequences, and how to verify both rollback and customer recovery. Escalate a release with no safe rollback or compensating plan.
6. Return a release record with sections for scope, evidence, risks, controls, rollback, decision, approvers, and follow-ups. The decision must be approve, approve with conditions, or hold; list each condition or blocker with an owner and due time.

Do not treat passing unit tests as evidence for migrations, configuration, deployment permissions, or production capacity. Do not approve a release when material evidence or a required owner is missing.`,
})

/** Contributes a lazy release-review workflow. */
export default Plugin.define({
  id: "example.release-review",
  async setup(context) {
    await context.skill.transform((editor) => editor.add(review))
  },
})
