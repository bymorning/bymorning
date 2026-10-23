/** Declares the Routing contract: Workspace rules that choose which Catalog Model a request uses. */
export * as Routing from "./routing.js"
export * as RoutingSchema from "./routing.js"

import { Schema, SchemaGetter } from "effect"
import * as Model from "./model.js"
import { NonNegativeInt } from "./schema.js"

/** Reserved Provider key of Auto names, which only Routing resolves. */
export const auto = "auto"

/** Whether a Model reference is an Auto name. */
export const isAuto = (model: Pick<Model.Ref, "provider">) => model.provider === auto

/** Request purposes a rule may match. The judge's own `route` requests never pass through Routing. */
export const Purpose = Schema.Literals(["assistant", "generate", "compaction", "title"])
export type Purpose = typeof Purpose.Type

/** Pattern matched against the latest participant ask. */
export const Text = Schema.Struct({
  pattern: Schema.NonEmptyString,
  flags: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[imsu]*$/))),
})
export interface Text extends Schema.Schema.Type<typeof Text> {}

/** Inclusive bounds on the estimated context size in tokens. */
export const Context = Schema.Struct({
  min: Schema.optionalKey(NonNegativeInt),
  max: Schema.optionalKey(NonNegativeInt),
})
export interface Context extends Schema.Schema.Type<typeof Context> {}

/** Condition keys a Match may carry. */
export const conditions = ["model", "purpose", "text", "context", "images", "agent", "tool"] as const

/** Conditions a rule matches. Every present condition must hold. Routing refuses to save a rule without one. */
export const Match = Schema.Struct({
  model: Schema.optionalKey(Model.Ref),
  purpose: Schema.optionalKey(Schema.Array(Purpose).check(Schema.isMinLength(1))),
  text: Schema.optionalKey(Text),
  context: Schema.optionalKey(Context),
  images: Schema.optionalKey(Schema.Boolean),
  agent: Schema.optionalKey(Schema.NonEmptyString),
  tool: Schema.optionalKey(Schema.NonEmptyString),
})
export interface Match extends Schema.Schema.Type<typeof Match> {}

/** A named, described Catalog Model a judge may choose. */
export const Tier = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,39}$/)),
  model: Model.Ref,
  description: Schema.NonEmptyString,
})
export interface Tier extends Schema.Schema.Type<typeof Tier> {}

/** The cheap Model that chooses a Tier and how much of the conversation it sees. */
export const Judge = Schema.Struct({
  model: Model.Ref,
  instructions: Schema.optionalKey(Schema.String),
  /** Earlier participant turns shown to the judge. */
  window: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10 }))),
  /** Milliseconds before the judge is abandoned for the default Tier. */
  timeout: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 30_000 }))),
})
export interface Judge extends Schema.Schema.Type<typeof Judge> {}

/** Tiers ordered from cheapest to most capable, the fallback Tier, and the judge. */
export const Tiers = Schema.Struct({
  tiers: Schema.Array(Tier).check(Schema.isMinLength(1)),
  default: Schema.NonEmptyString,
  judge: Judge,
})
export interface Tiers extends Schema.Schema.Type<typeof Tiers> {}

/** A rule target: one Catalog Model, or Tiers chosen by a judge. */
export const Target = Schema.Union([Tiers, Model.Ref])
export type Target = typeof Target.Type

/** Whether a target chooses among Tiers. */
export const isTiers = (target: Target): target is Tiers => "tiers" in target

const Current = Schema.Struct({ match: Match, to: Target })

const LegacyWhen = Schema.Struct({ tool: Schema.String })
/** Pre-Match rule shapes, decoded into the current shape and never written again. */
const Legacy = Schema.Union([
  Schema.Struct({ to: Model.Ref, from: Model.Ref, when: LegacyWhen }),
  Schema.Struct({ to: Model.Ref, from: Model.Ref }),
  Schema.Struct({ to: Model.Ref, when: LegacyWhen }),
]).pipe(
  Schema.decodeTo(Schema.toType(Current), {
    decode: SchemaGetter.transform((rule) => ({
      match: {
        ...("from" in rule ? { model: rule.from } : {}),
        ...("when" in rule ? { tool: rule.when.tool } : {}),
      },
      to: rule.to,
    })),
    encode: SchemaGetter.transform((rule) => {
      const to = rule.to as Model.Ref
      if (rule.match.model !== undefined && rule.match.tool !== undefined)
        return { to, from: rule.match.model, when: { tool: rule.match.tool } }
      if (rule.match.model !== undefined) return { to, from: rule.match.model }
      return { to, when: { tool: rule.match.tool ?? "" } }
    }),
  }),
)

/** One ordered routing rule. The last matching rule decides. Legacy `{to, from?, when?}` rules still decode. */
export const Rule = Schema.Union([Current, Legacy])
export type Rule = typeof Rule.Type

/** How a decision was reached. */
export const Cause = Schema.Literals(["none", "rule", "judge", "pinned", "fallback"])
export type Cause = typeof Cause.Type

/** Why the default Tier was used instead of a judged Tier. */
export const Fallback = Schema.Literals(["timeout", "invalid", "unavailable", "error", "unpinned"])
export type Fallback = typeof Fallback.Type

/** Durable record of one routing decision. */
export const Route = Schema.Struct({
  cause: Cause,
  rule: Schema.optionalKey(NonNegativeInt),
  tier: Schema.optionalKey(Schema.String),
  fallback: Schema.optionalKey(Fallback),
})
export interface Route extends Schema.Schema.Type<typeof Route> {}
