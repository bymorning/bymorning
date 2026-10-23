export * as Model from "./model.js"
export * as ModelSchema from "./model.js"

import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { optional, statics } from "./schema.js"
import * as Provider from "./provider.js"

const NonNegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/** Installation-registered Model identifier. */
export const ID = Schema.String.check(Schema.isStartsWith("mdl_")).pipe(
  Schema.brand("Model.ID"),
  statics((schema) => ({
    create: () => schema.make("mdl_" + ascending()),
  })),
)

/** Installation-registered Model identifier. */
export type ID = typeof ID.Type

/** Provider-native model selected for one assistant turn. */
export const Ref = Schema.Struct({
  id: Schema.String,
  provider: Provider.Name,
  variant: Schema.optionalKey(Schema.String),
})

/** Provider-native model selected for one assistant turn. */
export interface Ref extends Schema.Schema.Type<typeof Ref> {}

/** Legacy persisted Model name retained for the untouched database schema. */
export const Name = Schema.String.check(Schema.isMinLength(1)).pipe(Schema.brand("Model.Name"))
export type Name = typeof Name.Type

/** Model lifecycle status. */
export const Status = Schema.Literals(["enabled", "disabled"])

/** Model lifecycle status. */
export type Status = typeof Status.Type

export const Cost = Schema.Struct({
  input: optional(NonNegative),
  output: optional(NonNegative),
  cache: Schema.Struct({ read: optional(NonNegative), write: optional(NonNegative) }),
  tiers: optional(
    Schema.Array(
      Schema.Struct({
        input: optional(NonNegative),
        output: optional(NonNegative),
        cache: Schema.Struct({ read: optional(NonNegative), write: optional(NonNegative) }),
        tier: Schema.Struct({ type: Schema.tag("context"), size: NonNegative }),
      }),
    ),
  ),
  experimentalOver200K: optional(
    Schema.Struct({
      input: optional(NonNegative),
      output: optional(NonNegative),
      cache: Schema.Struct({ read: optional(NonNegative), write: optional(NonNegative) }),
    }),
  ),
})
export interface Cost extends Schema.Schema.Type<typeof Cost> {}

export const Capabilities = Schema.Struct({
  temperature: Schema.optionalKey(Schema.Boolean),
  reasoning: Schema.optionalKey(Schema.Boolean),
  attachment: Schema.optionalKey(Schema.Boolean),
  tools: Schema.optionalKey(Schema.Boolean),
  input: Schema.Array(Schema.String),
  output: Schema.Array(Schema.String),
})
export interface Capabilities extends Schema.Schema.Type<typeof Capabilities> {}

/** Model-owned execution overrides. A null package marks unsupported bundled transport. */
export const Execution = Schema.Struct({
  package: Schema.optionalKey(Schema.NullOr(Schema.String)),
  format: Schema.optionalKey(Provider.Format),
  settings: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  options: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  variants: Schema.optionalKey(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Json))),
})
export interface Execution extends Schema.Schema.Type<typeof Execution> {}

/** Public metadata and execution configuration for one effective Catalog Model. */
export const Info = Schema.Struct({
  id: Schema.String,
  provider: Provider.Name,
  apiID: Schema.String,
  name: Schema.NonEmptyString,
  description: Schema.String,
  family: optional(Schema.String),
  status: Schema.Literals(["alpha", "beta", "deprecated", "active"]),
  releaseDate: Schema.String,
  lastUpdated: Schema.String,
  openWeights: optional(Schema.Boolean),
  capabilities: Capabilities,
  variants: Schema.Array(Schema.String),
  limit: Schema.Struct({
    context: Schema.optionalKey(NonNegative),
    input: optional(NonNegative),
    output: optional(NonNegative),
  }),
  cost: Cost,
  execution: Schema.optionalKey(Execution),
}).annotate({ identifier: "Model.Info" })

/** Public metadata for one code-backed Provider model. */
export interface Info extends Schema.Schema.Type<typeof Info> {}

/** Variant-free model identity used by Workspace management policy. */
export const Identity = Schema.Struct({ provider: Provider.Name, id: Schema.String })
export interface Identity extends Schema.Schema.Type<typeof Identity> {}

/**
 * Key of a custom Model within its Provider. A slash would make its Gateway ID
 * ambiguous with a provider-qualified one.
 */
export const Key = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(200), Schema.isPattern(/^[^/\s]+$/))

const Label = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(200))
const Upstream = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(400))

/** A Workspace-configured custom Model on an existing Provider. Omitted prices and limits stay unknown. */
export const Custom = Schema.Struct({
  provider: Provider.Name,
  id: Key,
  /** Display label. */
  name: Label,
  /** Upstream model name sent to the Provider. */
  apiID: Upstream,
  /** USD per million tokens. */
  cost: Schema.optionalKey(
    Schema.Struct({ input: Schema.optionalKey(NonNegative), output: Schema.optionalKey(NonNegative) }),
  ),
  limit: Schema.optionalKey(Schema.Struct({ context: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))) })),
}).annotate({ identifier: "Model.Custom" })
export interface Custom extends Schema.Schema.Type<typeof Custom> {}

/** A custom Model to add; its key defaults to its upstream model name. */
export const CustomInput = Schema.Struct({
  ...Custom.fields,
  id: Schema.optionalKey(Key),
}).annotate({ identifier: "Model.CustomInput" })
export interface CustomInput extends Schema.Schema.Type<typeof CustomInput> {}

/** Workspace management projection for one visible model. */
export const Management = Schema.Struct({
  info: Info,
  enabled: Schema.Boolean,
  isPreferredDefault: Schema.Boolean,
  isEffectiveDefault: Schema.Boolean,
  /** Present and true when the Model is Workspace-configured custom configuration. */
  custom: Schema.optionalKey(Schema.Boolean),
  unavailableReason: Schema.optionalKey(
    Schema.Literals([
      "provider-inactive",
      "provider-disabled",
      "region-unsupported",
      "transport-unsupported",
      "connection-unavailable",
    ]),
  ),
})
export interface Management extends Schema.Schema.Type<typeof Management> {}

export const ToggleInput = Schema.Struct({ ...Identity.fields, enabled: Schema.Boolean })
export interface ToggleInput extends Schema.Schema.Type<typeof ToggleInput> {}
