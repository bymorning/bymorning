import type { RoutingRule } from "./rule-dialog"

/** Reserved Provider key of Auto names, which only Routing resolves. */
export const AUTO = "auto"

/** Display label of an Auto name. */
export const label = (id: string) => `Auto · ${id}`

/** Auto names use lowercase letters, digits, hyphens, and underscores, like Tier names. */
export const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/

type Tiers = Extract<RoutingRule["to"], { readonly tiers: unknown }>

/** One Auto model: the rule that matches only its Auto name and routes to judged Tiers. */
export interface AutoModel {
  readonly name: string
  readonly index: number
  readonly rule: RoutingRule & { readonly to: Tiers }
}

const hasTiers = (rule: RoutingRule): rule is RoutingRule & { readonly to: Tiers } => "tiers" in rule.to

/** Whether a rule is an Auto model: it matches only an Auto name and routes to Tiers. */
export function isAutoModel(rule: RoutingRule): rule is AutoModel["rule"] {
  const { model, ...rest } = rule.match
  return model?.provider === AUTO && Object.values(rest).every((value) => value === undefined) && hasTiers(rule)
}

/** Tier rules that are not Auto models. They are authored in Workspace configuration, not the Console. */
export const isConfigOnly = (rule: RoutingRule) => hasTiers(rule) && !isAutoModel(rule)

export function autoModels(rules: ReadonlyArray<RoutingRule>): ReadonlyArray<AutoModel> {
  return rules.flatMap((rule, index) => (isAutoModel(rule) ? [{ name: rule.match.model!.id, index, rule }] : []))
}

/** Every Auto name some rule matches, whether or not it is an Auto model. */
export const autoNames = (rules: ReadonlyArray<RoutingRule>) => [
  ...new Set(rules.flatMap((rule) => (rule.match.model?.provider === AUTO ? [rule.match.model.id] : []))),
]
