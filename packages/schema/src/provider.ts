export * as Provider from "./provider.js"
export * as ProviderSchema from "./provider.js"

import { Schema } from "effect"
import { AwsPartition, AwsRegion } from "./aws-region.js"
import { NonNegativeInt, optional } from "./schema.js"
import { Integration } from "./integration.js"

/** Stable code-backed Provider identity. */
const NameValue = Schema.String.check(Schema.isPattern(/^(?!prv_).+$/))

/** Stable code-backed Provider identity. */
export const Name = NameValue.pipe(Schema.brand("Provider.Name"))

/** Workspace-scoped Provider name. */
export type Name = typeof Name.Type

/** Legacy identity retained so persisted references decode as unavailable. */
export const Bymorning = Name.make("bymorning")
export const OpenAI = Name.make("openai")
export const DeepSeek = Name.make("deepseek")
export const Anthropic = Name.make("anthropic")
export const Google = Name.make("google")
export const OpenCode = Name.make("opencode")
export const Fireworks = Name.make("fireworks")
export const AmazonBedrock = Name.make("amazon-bedrock")

/** Upstream source format implemented by a Provider. */
export const Format = Schema.Literals(["anthropic", "bedrock-converse", "google", "openai", "oa-compat"])

/** Upstream source format implemented by a Provider. */
export type Format = typeof Format.Type

/** Provider API endpoint concatenated exactly by execution adapters. */
const APIValue = Schema.String

/** Provider API endpoint concatenated exactly by execution adapters. */
export const API = APIValue.pipe(Schema.brand("Provider.API"))

/** Provider API endpoint concatenated exactly by execution adapters. */
export type API = typeof API.Type

/** Code-owned endpoint selection. AWS endpoints are derived from the validated region, in any listed partition. */
export const EndpointStrategy = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("fixed"), api: API }),
  Schema.Struct({ _tag: Schema.Literal("aws-regional"), partitions: Schema.NonEmptyArray(AwsPartition) }),
])
  .pipe(Schema.toTaggedUnion("_tag"))
  .annotate({ identifier: "Provider.EndpointStrategy" })
export type EndpointStrategy = typeof EndpointStrategy.Type

/**
 * Canonical Bedrock Runtime origin; commercial and GovCloud regions share the
 * hostname shape. `fips` selects the FIPS-designated hostname
 * (`bedrock-runtime-fips.<region>.amazonaws.com`), which AWS operates in the
 * commercial FIPS regions and both GovCloud regions under the same
 * amazonaws.com suffix; its PrivateLink service name is likewise
 * `com.amazonaws.<region>.bedrock-runtime-fips`.
 */
export const bedrockRuntimeAPI = (region: AwsRegion, options?: { readonly fips?: boolean }) =>
  API.make(`https://${options?.fips === true ? "bedrock-runtime-fips" : "bedrock-runtime"}.${region}.amazonaws.com`)

/** Ordered JSON object used for Provider and Route modifiers. */
export const JsonObject = Schema.Record(Schema.String, Schema.Json)

/** Ordered JSON object used for Provider and Route modifiers. */
export interface JsonObject extends Schema.Schema.Type<typeof JsonObject> {}

/** Provider lifecycle status. */
export const Status = Schema.Literals(["auto", "enabled", "disabled"])

/** Provider lifecycle status. */
export type Status = typeof Status.Type

/** Explicit outbound authentication; secret material remains in Integration. */
export const Authentication = Schema.Union([
  Schema.Struct({ type: Schema.tag("none") }),
  Schema.Struct({
    type: Schema.tag("key"),
    integration: Schema.String,
    header: Schema.NonEmptyString,
    prefix: Schema.optionalKey(Schema.String),
  }),
])
export type Authentication = typeof Authentication.Type

/** Effective Provider execution defaults, never inferred from discovery hints. */
export const Execution = Schema.Struct({
  package: Schema.optionalKey(Schema.String),
  settings: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  options: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  authentication: Authentication,
})
export interface Execution extends Schema.Schema.Type<typeof Execution> {}

/** Public Provider description and explicit execution defaults. */
export const Info = Schema.Struct({
  name: Name,
  displayName: optional(Schema.String),
  api: optional(API),
  format: Format,
  status: Status,
  execution: Schema.optionalKey(Execution),
}).annotate({ identifier: "Provider.Info" })

/** Public, code-backed Provider description. */
export interface Info extends Schema.Schema.Type<typeof Info> {}

/** Replace the activation policy of one existing Catalog Provider. */
export const UpdateInput = Schema.Struct({
  provider: Name,
  status: Status,
}).annotate({ identifier: "Provider.UpdateInput" })

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}

/** Workspace projection for managing one installed code-backed Provider. */
export const DirectoryEntry = Schema.Struct({
  info: Info,
  integration: Schema.optionalKey(Integration.Info),
  active: Schema.Boolean,
  connected: Schema.Boolean,
  connectionCount: NonNegativeInt,
  modelCount: NonNegativeInt,
}).annotate({ identifier: "Provider.DirectoryEntry" })

/** Workspace projection for managing one installed code-backed Provider. */
export interface DirectoryEntry extends Schema.Schema.Type<typeof DirectoryEntry> {}
