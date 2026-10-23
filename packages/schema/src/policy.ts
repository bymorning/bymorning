/** Declarative policy contracts shared by plugins and policy transports. */
export * as PolicySchema from "./policy.js"

import { Schema } from "effect"
import { Plugin } from "./plugin.js"

/** Whole-string wildcard: `*` matches any run, `?` matches one character. */
export const Pattern = Schema.String.annotate({ identifier: "Policy.Pattern" }).check(Schema.isMinLength(1))

/** Canonical `provider/model[#variant]` reference. The `default` variant is omitted. */
export const ModelResource = Schema.String.annotate({ identifier: "Policy.ModelResource" }).check(
  Schema.isPattern(/^[^/#]+\/[^/#]+(#[^/#]+)?$/),
)

/**
 * ECMAScript regular expression source with a restricted flag set. Compilation is verified by `Definition` and
 * `Policies`, not here, so that `Rule` stays representable by the generated HTTP client.
 */
export const Regex = Schema.Struct({
  pattern: Schema.NonEmptyString.check(Schema.isMaxLength(512)),
  flags: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[imsu]*$/))),
}).annotate({ identifier: "Policy.Regex" })
export interface Regex extends Schema.Schema.Type<typeof Regex> {}

/** Compile a policy regex. RegExp construction is the only way to validate a source string. */
export const compile = (regex: Regex) => {
  try {
    return new RegExp(regex.pattern, regex.flags)
  } catch {
    return undefined
  }
}

/** A literal header value or a reference to a server environment variable resolved at request time. */
export const HeaderValue = Schema.Union([Schema.String, Schema.Struct({ env: Schema.NonEmptyString })]).annotate({
  identifier: "Policy.HeaderValue",
})
export type HeaderValue = typeof HeaderValue.Type

export const Purpose = Schema.Literals(["assistant", "generate", "compaction", "title"]).annotate({
  identifier: "Policy.Purpose",
})
export type Purpose = typeof Purpose.Type

export const GuardrailAllowRule = Schema.Struct({
  type: Schema.Literal("guardrail"),
  action: Pattern,
  resource: Pattern,
  effect: Schema.Literal("allow"),
})
export interface GuardrailAllowRule extends Schema.Schema.Type<typeof GuardrailAllowRule> {}

export const GuardrailDenyRule = Schema.Struct({
  type: Schema.Literal("guardrail"),
  action: Pattern,
  resource: Pattern,
  effect: Schema.Literal("deny"),
  message: Schema.optionalKey(Schema.String),
})
export interface GuardrailDenyRule extends Schema.Schema.Type<typeof GuardrailDenyRule> {}

export const GuardrailRule = Schema.Union([GuardrailAllowRule, GuardrailDenyRule])
export type GuardrailRule = typeof GuardrailRule.Type

export const RouteRule = Schema.Struct({
  type: Schema.Literal("route"),
  action: Schema.Literals(["model.request", "provider.request"]),
  resource: Pattern,
  target: Schema.NonEmptyString,
})
export interface RouteRule extends Schema.Schema.Type<typeof RouteRule> {}

/** Redirect the physical request for matching models to another endpoint and/or add headers. Requires one of them. */
export const EndpointRule = Schema.Struct({
  type: Schema.Literal("endpoint"),
  model: Pattern,
  baseURL: Schema.optionalKey(Schema.NonEmptyString),
  headers: Schema.optionalKey(Schema.Record(Schema.String, HeaderValue)),
}).annotate({ identifier: "Policy.EndpointRule" })
export interface EndpointRule extends Schema.Schema.Type<typeof EndpointRule> {}

/** Route later requests in a Session to `target` once a matching Tool has been admitted. */
export const EscalateRule = Schema.Struct({
  type: Schema.Literal("escalate"),
  tool: Pattern,
  target: ModelResource,
  purpose: Schema.optionalKey(Schema.Array(Purpose)),
}).annotate({ identifier: "Policy.EscalateRule" })
export interface EscalateRule extends Schema.Schema.Type<typeof EscalateRule> {}

/** Deny a Tool call when the input at `path` (or the whole JSON input) matches. */
export const ToolInputRule = Schema.Struct({
  type: Schema.Literal("tool.input"),
  tool: Pattern,
  path: Schema.optionalKey(Schema.NonEmptyString),
  match: Regex,
  message: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "Policy.ToolInputRule" })
export interface ToolInputRule extends Schema.Schema.Type<typeof ToolInputRule> {}

/** Replace matches in Tool text output before the model sees it. */
export const ToolOutputRule = Schema.Struct({
  type: Schema.Literal("tool.output"),
  tool: Pattern,
  match: Regex,
  replacement: Schema.String,
}).annotate({ identifier: "Policy.ToolOutputRule" })
export interface ToolOutputRule extends Schema.Schema.Type<typeof ToolOutputRule> {}

/** Append a system instruction for matching models and Agents on every request. */
export const InstructionRule = Schema.Struct({
  type: Schema.Literal("instruction"),
  model: Pattern,
  agent: Schema.optionalKey(Pattern),
  text: Schema.NonEmptyString,
}).annotate({ identifier: "Policy.InstructionRule" })
export interface InstructionRule extends Schema.Schema.Type<typeof InstructionRule> {}

/** Rewrite user prompt text before it is persisted. */
export const PromptRule = Schema.Struct({
  type: Schema.Literal("prompt"),
  match: Regex,
  replacement: Schema.String,
}).annotate({ identifier: "Policy.PromptRule" })
export interface PromptRule extends Schema.Schema.Type<typeof PromptRule> {}

export const Rule = Schema.Union([
  GuardrailAllowRule,
  GuardrailDenyRule,
  RouteRule,
  EndpointRule,
  EscalateRule,
  ToolInputRule,
  ToolOutputRule,
  InstructionRule,
  PromptRule,
]).annotate({ identifier: "Policy.Rule" })
export type Rule = typeof Rule.Type

export const RuleType = Schema.Literals([
  "guardrail",
  "route",
  "endpoint",
  "escalate",
  "tool.input",
  "tool.output",
  "instruction",
  "prompt",
]).annotate({ identifier: "Policy.RuleType" })
export type RuleType = typeof RuleType.Type

export const Policy = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  description: Schema.optionalKey(Schema.String),
  enabled: Schema.Boolean,
  rules: Schema.Array(Rule),
}).annotate({ identifier: "Policy" })
export interface Policy extends Schema.Schema.Type<typeof Policy> {}

/** Semantic constraints that the structural rule schemas cannot express. Returns the first problem. */
export const issue = (rules: ReadonlyArray<Rule>): string | undefined => {
  for (const [index, rule] of rules.entries()) {
    if (rule.type === "endpoint" && rule.baseURL === undefined && rule.headers === undefined)
      return `Rule ${index}: endpoint requires baseURL or headers`
    if ("match" in rule && compile(rule.match) === undefined)
      return `Rule ${index}: invalid regular expression ${JSON.stringify(rule.match.pattern)}`
  }
  return undefined
}

/** Plugin-facing input. `enabled` defaults to `true` when the host admits the policy. */
export const Definition = Schema.Struct({
  ...Policy.fields,
  enabled: Schema.optionalKey(Schema.Boolean),
})
  .annotate({ identifier: "Policy.Definition" })
  .check(Schema.makeFilter((policy) => issue(policy.rules)))
export interface Definition extends Schema.Schema.Type<typeof Definition> {}

export const Policies = Schema.Array(Policy)
  .check(
    Schema.makeFilter((policies) => {
      const duplicate = policies.find(
        (policy, index) => policies.findIndex((candidate) => candidate.id === policy.id) !== index,
      )
      return duplicate === undefined ? undefined : `Duplicate policy ID: ${duplicate.id}`
    }),
    Schema.makeFilter((policies) => {
      const invalid = policies.flatMap((policy) => {
        const problem = issue(policy.rules)
        return problem === undefined ? [] : [`Policy ${policy.id}: ${problem}`]
      })
      return invalid[0]
    }),
  )
  .annotate({ identifier: "Policy.Policies" })

/** Host-owned provenance. This is deliberately absent from plugin policies. */
export const Source = Schema.Struct({
  type: Schema.Literal("plugin"),
  pluginID: Plugin.ID,
  pluginSource: Plugin.Source,
}).annotate({ identifier: "Policy.Source" })
export interface Source extends Schema.Schema.Type<typeof Source> {}

export const ManagedSource = Source.make({
  type: "plugin",
  pluginID: Plugin.ID.make("core.policy.managed"),
  pluginSource: { type: "builtin" },
})

export const Info = Schema.Struct({
  ...Policy.fields,
  source: Source,
  managed: Schema.Boolean,
  suppressed: Schema.Boolean,
}).annotate({ identifier: "Policy.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const Trace = Schema.Struct({
  policyID: Policy.fields.id,
  rule: Schema.Finite,
  type: RuleType,
  matched: Schema.Boolean,
  selected: Schema.Boolean,
}).annotate({ identifier: "Policy.Trace" })
export interface Trace extends Schema.Schema.Type<typeof Trace> {}
