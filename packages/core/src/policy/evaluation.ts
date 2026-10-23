import type { GuardrailRule, Policy, RouteRule, Trace } from "@bymorning/schema/policy"
import { Wildcard } from "../wildcard.js"

export const match = Wildcard.match

export interface Evaluation {
  readonly guardrail: {
    readonly effect: "allow" | "deny"
    readonly message?: string
  }
  readonly route?: string
  readonly trace: ReadonlyArray<Trace>
}

/** Evaluate ordered policies with the last matching guardrail and route winning independently. */
export const evaluate = (
  action: string,
  resource: string,
  policies: ReadonlyArray<Policy>,
): Evaluation => {
  const trace: Array<Trace> = []
  let guardrail: GuardrailRule | undefined
  let route: RouteRule | undefined
  let selectedGuardrail: number | undefined
  let selectedRoute: number | undefined

  for (const policy of policies) {
    if (!policy.enabled) continue
    for (const [ruleIndex, rule] of policy.rules.entries()) {
      // Only action/resource kinds participate in this evaluation; other kinds are selected by `Policy.select`.
      if (rule.type !== "guardrail" && rule.type !== "route") continue
      const matched = match(action, rule.action) && match(resource, rule.resource)
      trace.push({ policyID: policy.id, rule: ruleIndex, type: rule.type, matched, selected: false })
      if (!matched) continue
      if (rule.type === "guardrail") {
        guardrail = rule
        selectedGuardrail = trace.length - 1
        continue
      }
      route = rule
      selectedRoute = trace.length - 1
    }
  }

  const selectedTrace = trace.map((item, index) =>
    Object.freeze({ ...item, selected: index === selectedGuardrail || index === selectedRoute }),
  )
  const decision =
    guardrail === undefined || guardrail.effect === "allow"
      ? { effect: "allow" as const }
      : Object.freeze({
          effect: guardrail.effect,
          ...(guardrail.message === undefined ? {} : { message: guardrail.message }),
        })
  return Object.freeze({
    guardrail: Object.freeze(decision),
    ...(route === undefined ? {} : { route: route.target }),
    trace: Object.freeze(selectedTrace),
  })
}

export * as PolicyEvaluation from "./evaluation.js"
