import type { RoutingRule } from "./rule-dialog"

type Priority = "this" | "existing"
type Ref = { readonly provider: string; readonly id: string; readonly variant?: string }
type Match = RoutingRule["match"]

export class PlacementError extends Error {
  override readonly name = "PlacementError"

  constructor() {
    super("This priority conflicts with route specificity. Review the routes and try again.")
  }
}

function refEqual(left: Ref, right: Ref) {
  return left.provider === right.provider && left.id === right.id && (left.variant ?? "default") === (right.variant ?? "default")
}

const refKey = (ref: Ref) => [ref.provider, ref.id, ref.variant ?? "default"]

/** Canonical, order-independent form of a Match for identity and comparison. */
function normal(match: Match) {
  return {
    model: match.model === undefined ? null : refKey(match.model),
    purpose: match.purpose === undefined ? null : [...new Set(match.purpose)].sort(),
    text: match.text === undefined ? null : [match.text.pattern, [...(match.text.flags ?? "")].sort().join("")],
    context: match.context === undefined ? null : [match.context.min ?? null, match.context.max ?? null],
    images: match.images ?? null,
    agent: match.agent ?? null,
    tool: match.tool ?? null,
  }
}

type Normal = ReturnType<typeof normal>
const keys = ["model", "purpose", "text", "context", "images", "agent", "tool"] as const

function targetIdentity(rule: RoutingRule) {
  const to = rule.to
  if ("tiers" in to)
    return JSON.stringify({
      tiers: to.tiers.map((tier) => [tier.name, refKey(tier.model), tier.description]),
      default: to.default,
      judge: [refKey(to.judge.model), to.judge.instructions ?? null, to.judge.window ?? null, to.judge.timeout ?? null],
    })
  return JSON.stringify(refKey(to))
}

export function sameMatcher(left: RoutingRule, right: RoutingRule) {
  return JSON.stringify(normal(left.match)) === JSON.stringify(normal(right.match))
}

/** Whether some request could satisfy both rules' conditions. Text and completed-Tool conditions may co-occur. */
export function overlaps(left: RoutingRule, right: RoutingRule) {
  const a = left.match
  const b = right.match
  if (a.model !== undefined && b.model !== undefined && !refEqual(a.model, b.model)) return false
  if (a.agent !== undefined && b.agent !== undefined && a.agent !== b.agent) return false
  if (a.images !== undefined && b.images !== undefined && a.images !== b.images) return false
  if (a.purpose !== undefined && b.purpose !== undefined && !a.purpose.some((purpose) => b.purpose!.includes(purpose)))
    return false
  if (a.context !== undefined && b.context !== undefined) {
    const low = Math.max(a.context.min ?? 0, b.context.min ?? 0)
    const high = Math.min(a.context.max ?? Infinity, b.context.max ?? Infinity)
    if (low > high) return false
  }
  return true
}

export function conflicts(left: RoutingRule, right: RoutingRule) {
  return overlaps(left, right) && targetIdentity(left) !== targetIdentity(right)
}

/** Whether `inner` holds for every request `outer` would admit, for one condition. */
function narrower(key: (typeof keys)[number], inner: Normal, outer: Normal) {
  const outerValue = outer[key]
  const innerValue = inner[key]
  if (outerValue === null) return true
  if (innerValue === null) return false
  if (key === "purpose") return (innerValue as string[]).every((purpose) => (outerValue as string[]).includes(purpose))
  if (key === "context") {
    const [innerMin, innerMax] = innerValue as [number | null, number | null]
    const [outerMin, outerMax] = outerValue as [number | null, number | null]
    return (innerMin ?? 0) >= (outerMin ?? 0) && (innerMax ?? Infinity) <= (outerMax ?? Infinity)
  }
  return JSON.stringify(innerValue) === JSON.stringify(outerValue)
}

/** Whether `candidate` applies to a strict subset of the requests `existing` applies to. */
export function isStrictRefinement(candidate: RoutingRule, existing: RoutingRule) {
  const inner = normal(candidate.match)
  const outer = normal(existing.match)
  return keys.every((key) => narrower(key, inner, outer)) && !keys.every((key) => narrower(key, outer, inner))
}

export function ambiguousConflicts(candidate: RoutingRule, existing: ReadonlyArray<RoutingRule>) {
  return existing.filter((rule) =>
    conflicts(candidate, rule) && !isStrictRefinement(candidate, rule) && !isStrictRefinement(rule, candidate),
  )
}

function ruleIdentity(rule: RoutingRule) {
  return JSON.stringify([normal(rule.match), targetIdentity(rule)])
}

export function sameRule(left: RoutingRule, right: RoutingRule) {
  return ruleIdentity(left) === ruleIdentity(right)
}

export function conflictIdentity(candidate: RoutingRule, existing: ReadonlyArray<RoutingRule>) {
  return ambiguousConflicts(candidate, existing)
    .map(ruleIdentity)
    .sort()
    .join("\n")
}

/** Inserts a rule without exposing Config.routing's global order. Later matching rules win. */
export function insertRoute(
  existing: ReadonlyArray<RoutingRule>,
  candidate: RoutingRule,
  priority?: Priority,
  preferred = existing.length,
) {
  let lower = 0
  let upper = existing.length
  existing.forEach((rule, index) => {
    if (!conflicts(candidate, rule)) return
    if (isStrictRefinement(candidate, rule) || (priority === "this" && !isStrictRefinement(rule, candidate))) {
      lower = Math.max(lower, index + 1)
    }
    if (isStrictRefinement(rule, candidate) || (priority === "existing" && !isStrictRefinement(candidate, rule))) {
      upper = Math.min(upper, index)
    }
  })
  if (lower > upper) throw new PlacementError()
  const index = Math.max(lower, Math.min(preferred, upper))
  return [...existing.slice(0, index), candidate, ...existing.slice(index)]
}

export function conflictCount(rules: ReadonlyArray<RoutingRule>) {
  let count = 0
  for (let left = 0; left < rules.length; left += 1) {
    for (let right = left + 1; right < rules.length; right += 1) {
      if (!conflicts(rules[left]!, rules[right]!)) continue
      const ambiguous = !isStrictRefinement(rules[left]!, rules[right]!) && !isStrictRefinement(rules[right]!, rules[left]!)
      const reversedRefinement = isStrictRefinement(rules[left]!, rules[right]!)
      if (ambiguous || reversedRefinement) count += 1
    }
  }
  return count
}
