export * as Credential from "./credential.js"

import { Schema } from "effect"
import { optional } from "./schema.js"
import { IntegrationMethodID } from "./integration-id.js"
import { ascending } from "./identifier.js"
import { NonNegativeInt, statics } from "./schema.js"
import { Form } from "./form.js"
import { AwsRegion } from "./aws-region.js"

export const ID = Schema.String.pipe(
  Schema.brand("Credential.ID"),
  statics((schema) => ({ create: () => schema.make("cred_" + ascending()) })),
)
export type ID = typeof ID.Type

export const Scope = Schema.Literals(["member", "workspace"]).annotate({ identifier: "Credential.Scope" })
export type Scope = typeof Scope.Type

export interface OAuth extends Schema.Schema.Type<typeof OAuth> {}
export const OAuth = Schema.Struct({
  type: Schema.Literal("oauth"),
  methodID: IntegrationMethodID,
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  metadata: optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "Credential.OAuth" })

export interface Key extends Schema.Schema.Type<typeof Key> {}
export const AwsRegionConfiguration = Schema.Struct({
  type: Schema.Literal("aws-region"),
  region: AwsRegion,
}).annotate({ identifier: "Credential.AwsRegionConfiguration" })
export interface AwsRegionConfiguration extends Schema.Schema.Type<typeof AwsRegionConfiguration> {}

const LegacyKeyConfiguration = Form.Answer.check(
  Schema.makeFilter((configuration) =>
    configuration.type === "aws-region" ? "AWS region configuration must match its typed contract" : undefined,
  ),
)

export const Key = Schema.Struct({
  type: Schema.Literal("key"),
  key: Schema.String,
  metadata: optional(Schema.Record(Schema.String, Schema.Unknown)),
  configuration: optional(Schema.Union([AwsRegionConfiguration, LegacyKeyConfiguration])),
}).annotate({ identifier: "Credential.Key" })

/** Bedrock bearer credential decoded at the provider boundary. */
export const AwsBearer = Schema.Struct({
  ...Key.fields,
  configuration: AwsRegionConfiguration,
}).annotate({ identifier: "Credential.AwsBearer" })
export interface AwsBearer extends Schema.Schema.Type<typeof AwsBearer> {}

export const AwsSigV4 = Schema.Struct({
  type: Schema.Literal("aws-sigv4"),
  region: AwsRegion,
  accessKeyId: Schema.NonEmptyString,
  secretAccessKey: Schema.NonEmptyString,
  sessionToken: Schema.optionalKey(Schema.NonEmptyString),
}).annotate({ identifier: "Credential.AwsSigV4" })
export interface AwsSigV4 extends Schema.Schema.Type<typeof AwsSigV4> {}

/** One member's named secret values for an Integration's values method. */
export const Values = Schema.Struct({
  type: Schema.Literal("values"),
  values: Schema.Record(Schema.String, Schema.String),
}).annotate({ identifier: "Credential.Values" })
export interface Values extends Schema.Schema.Type<typeof Values> {}

export const Value = Schema.Union([OAuth, Key, AwsSigV4, Values])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Credential.Value" })
export type Value = Schema.Schema.Type<typeof Value>
