export * as Match from "./match.js"

import type { Model } from "@bymorning/schema/model"
import type { Routing } from "@bymorning/schema/routing"
import type { Digest } from "./digest.js"

/** Facts one rule's conditions are evaluated against. */
export interface Facts {
  readonly requestedModel: Model.Ref
  readonly purpose: string
  readonly agent?: string
  readonly digest?: Digest
  /** Tools completed in the Session; absent outside a Session. */
  readonly tools?: ReadonlySet<string>
}

/** Canonical `provider/id[#variant]` form used to compare Model references. */
export const resource = (model: Model.Ref) =>
  `${model.provider}/${model.id}${model.variant === undefined || model.variant === "default" ? "" : `#${model.variant}`}`

/** Text conditions test only this leading prefix of the ask, bounding the cost of an expensive pattern. */
export const textLimit = 20_000

const compiled = new Map<string, RegExp | undefined>()

/** Compile a rule pattern once; an invalid pattern never matches. */
export const pattern = (text: Routing.Text) => {
  const key = `${text.flags ?? ""}/${text.pattern}`
  if (!compiled.has(key)) {
    try {
      compiled.set(key, new RegExp(text.pattern, text.flags))
    } catch {
      compiled.set(key, undefined)
    }
  }
  return compiled.get(key)
}

/** Whether every present condition of a Match holds. */
export const matches = (match: Routing.Match, facts: Facts): boolean => {
  if (match.model !== undefined && resource(match.model) !== resource(facts.requestedModel)) return false
  if (match.purpose !== undefined && !match.purpose.some((purpose) => purpose === facts.purpose)) return false
  if (match.agent !== undefined && match.agent !== facts.agent) return false
  // Completed-Tool conditions apply only to a Session's assistant requests, as before Routing gained Tiers.
  if (match.tool !== undefined && !(facts.purpose === "assistant" && facts.tools?.has(match.tool))) return false
  if (match.text !== undefined) {
    const regex = pattern(match.text)
    const ask = facts.digest === undefined ? undefined : facts.digest.ask.slice(0, textLimit)
    if (regex === undefined || ask === undefined || !regex.test(ask)) return false
  }
  if (match.context !== undefined) {
    if (facts.digest === undefined) return false
    if (match.context.min !== undefined && facts.digest.tokens < match.context.min) return false
    if (match.context.max !== undefined && facts.digest.tokens > match.context.max) return false
  }
  if (match.images !== undefined && (facts.digest?.images ?? false) !== match.images) return false
  return true
}

/** Index of the last matching rule, which decides. */
export const decide = (rules: ReadonlyArray<Routing.Rule>, facts: Facts) =>
  rules.findLastIndex((rule) => matches(rule.match, facts))
