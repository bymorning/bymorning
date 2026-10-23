import { Schema } from "effect"
import { descriptors } from "./descriptors.js"

const NonNegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
const Positive = Schema.Finite.check(Schema.isGreaterThan(0))
const DateString = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}(?:-\d{2})?$/),
  Schema.makeFilter((value) => {
    const normalized = value.length === 7 ? `${value}-01` : value
    const parsed = new Date(`${normalized}T00:00:00.000Z`)
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === normalized
      ? true
      : "Expected a calendar date"
  }),
)
const Modalities = Schema.Array(Schema.NonEmptyString).check(
  Schema.makeFilter((values) => new Set(values).size === values.length || "Expected unique modalities"),
)
const CostDimensions = {
  input: Schema.optionalKey(NonNegative),
  output: Schema.optionalKey(NonNegative),
  cache_read: Schema.optionalKey(NonNegative),
  cache_write: Schema.optionalKey(NonNegative),
  input_audio: Schema.optionalKey(NonNegative),
  output_audio: Schema.optionalKey(NonNegative),
  reasoning: Schema.optionalKey(NonNegative),
}

const Cost = Schema.Struct({
  ...CostDimensions,
  tiers: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        ...CostDimensions,
        tier: Schema.Struct({ type: Schema.Literal("context"), size: Positive }),
      }),
    ).check(
      Schema.makeFilter(
        (tiers) =>
          tiers.every((tier, index) => index === 0 || tier.tier.size > tiers[index - 1]!.tier.size) ||
          "Expected ascending tiers",
      ),
    ),
  ),
  context_over_200k: Schema.optionalKey(Schema.Struct(CostDimensions)),
})

const ReasoningOption = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("budget_tokens"),
    min: Schema.optionalKey(Schema.Finite),
    max: Schema.optionalKey(Schema.Finite),
  }),
  Schema.Struct({
    type: Schema.Literal("effort"),
    values: Schema.NonEmptyArray(Schema.NullOr(Schema.NonEmptyString)),
  }),
  Schema.Struct({ type: Schema.Literal("toggle") }),
])

const JsonObject = Schema.Record(Schema.String, Schema.Json)
const ProviderRequest = Schema.Struct({
  body: JsonObject,
  headers: Schema.optionalKey(JsonObject),
})

const Experimental = Schema.Struct({
  modes: Schema.Record(
    Schema.NonEmptyString,
    Schema.Struct({ cost: Schema.optionalKey(Cost), provider: ProviderRequest }),
  ),
})

const Interleaved = Schema.Union([Schema.Literal(true), Schema.Struct({ field: Schema.NonEmptyString })])

const ProviderOverride = Schema.Struct({
  npm: Schema.optionalKey(Schema.NonEmptyString),
  api: Schema.optionalKey(Schema.NonEmptyString),
  shape: Schema.optionalKey(Schema.Literals(["completions", "responses"])),
})

export const Model = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  description: Schema.optionalKey(Schema.String),
  family: Schema.optionalKey(Schema.String),
  attachment: Schema.Boolean,
  reasoning: Schema.Boolean,
  reasoning_options: Schema.optionalKey(Schema.Array(ReasoningOption)),
  tool_call: Schema.Boolean,
  structured_output: Schema.optionalKey(Schema.Boolean),
  temperature: Schema.optionalKey(Schema.Boolean),
  knowledge: Schema.optionalKey(Schema.String),
  release_date: DateString,
  last_updated: DateString,
  modalities: Schema.Struct({
    input: Modalities,
    output: Modalities,
  }),
  open_weights: Schema.Boolean,
  limit: Schema.Struct({
    context: NonNegative,
    input: Schema.optionalKey(NonNegative),
    output: Schema.optionalKey(NonNegative),
  }),
  cost: Schema.optionalKey(Cost),
  status: Schema.optionalKey(Schema.Literals(["deprecated", "beta"])),
  experimental: Schema.optionalKey(Experimental),
  interleaved: Schema.optionalKey(Interleaved),
  provider: Schema.optionalKey(ProviderOverride),
})

export const Provider = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  npm: Schema.NonEmptyString,
  env: Schema.Array(Schema.NonEmptyString),
  doc: Schema.optionalKey(Schema.String),
  api: Schema.optionalKey(Schema.String),
  models: Schema.Record(Schema.String, Model),
})

/** Complete models.dev API catalog keyed by provider ID. */
export const Catalog = Schema.Record(Schema.String, Provider)

const Sha256 = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))
export const SourcePin = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  url: Schema.Literal("https://models.dev/api.json"),
  observedOn: DateString,
  bodyDigest: Sha256,
  bodyBytes: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThan(0)),
  providers: Schema.Array(
    Schema.Struct({
      localID: Schema.Literals(descriptors.map((descriptor) => descriptor.localID)),
      sourceID: Schema.Literals(descriptors.map((descriptor) => descriptor.sourceID)),
      digest: Sha256,
      modelCount: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    }),
  ),
  icons: Schema.Struct({
    repository: Schema.Literal("anomalyco/models.dev"),
    commit: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)),
    digests: Schema.Record(Schema.String, Sha256),
  }),
})

export type Model = typeof Model.Type
export type Provider = typeof Provider.Type
export type Catalog = typeof Catalog.Type
export type ReasoningOption = typeof ReasoningOption.Type
export type Cost = typeof Cost.Type

export const decodeProvider = Schema.decodeUnknownSync(Provider, { errors: "all", onExcessProperty: "error" })
export const decodeSourcePin = Schema.decodeUnknownSync(SourcePin, { errors: "all", onExcessProperty: "error" })
export const decodeSourceBody = Schema.decodeUnknownSync(Schema.fromJsonString(Catalog), {
  errors: "all",
  onExcessProperty: "error",
})
