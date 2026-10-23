import { Plugin } from "@bymorning/plugin"
import { Skill } from "@bymorning/schema/skill"

const incident = Skill.Info.make({
  id: Skill.ID.make("incident-response"),
  name: "Incident response",
  description: "Coordinate an evidence-led production incident from triage through follow-up.",
  instructions: `# Incident response

Use this workflow when availability, correctness, security, or customer impact may be degraded.

1. Establish a timestamped incident record. State the observed symptom, start time, affected service or journey, reporter, and current severity. Do not convert an assumption into a fact.
2. Preserve evidence before changing production: request IDs, trace or log links, deployment and configuration versions, dashboards, error samples, and the known-good versus failing time range. Redact secrets and customer data from the record.
3. Bound impact with numbers: affected tenants or users, failed requests versus total requests, regions, and the last known healthy time. Name the evidence source and its observation window.
4. Form competing hypotheses. For each one, record the cheapest discriminating check and its result. Check recent deploys, configuration changes, dependency health, saturation, and permission or authentication failures before choosing mitigation.
5. Choose the lowest-risk reversible mitigation. Name its owner, exact change, expected signal, rollback trigger, and verification window. Obtain required operational approval before an action that needs it.
6. Verify recovery using the original failing path plus independent service and customer-impact signals. Do not close because an alert is quiet alone.
7. Publish a handoff or closure note with timeline, impact, evidence, mitigation, unresolved risk, follow-up owner, and due date. Separate confirmed cause from contributing factors and open questions.

Keep updates short and timestamped. Escalate immediately when evidence indicates data loss, unauthorized access, sustained broad impact, or an irreversible mitigation.`,
})

/** Contributes a lazy, evidence-led incident response workflow. */
export default Plugin.define({
  id: "example.incident-response",
  async setup(context) {
    await context.skill.transform((editor) => editor.add(incident))
  },
})
