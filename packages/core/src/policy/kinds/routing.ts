import type { HeaderValue, Purpose } from "@bymorning/schema/policy"
import type { Policy } from "../../policy.js"
import { Wildcard } from "../../wildcard.js"

export const endpoint = (
  selected: ReadonlyArray<Policy.Selected<"endpoint">>,
  model: string,
):
  | {
      readonly baseURL?: string
      readonly headers: Record<string, HeaderValue>
      readonly policyID: string
      readonly rule: number
    }
  | undefined => {
  const item = selected.findLast((candidate) => Wildcard.match(model, candidate.definition.model))
  if (item === undefined) return undefined
  return {
    ...(item.definition.baseURL === undefined ? {} : { baseURL: item.definition.baseURL }),
    headers: { ...item.definition.headers },
    policyID: item.policyID,
    rule: item.rule,
  }
}

export const escalate = (
  selected: ReadonlyArray<Policy.Selected<"escalate">>,
  admitted: ReadonlySet<string>,
  purpose: Purpose,
): { readonly target: string; readonly tool: string; readonly policyID: string; readonly rule: number } | undefined => {
  const tools = Array.from(admitted).sort()
  for (const item of selected.toReversed()) {
    if (!(item.definition.purpose ?? ["assistant"]).includes(purpose)) continue
    const tool = tools.find((candidate) => Wildcard.match(candidate, item.definition.tool))
    if (tool === undefined) continue
    return { target: item.definition.target, tool, policyID: item.policyID, rule: item.rule }
  }
  return undefined
}

export * as PolicyRoutingKinds from "./routing.js"
