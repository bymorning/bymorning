export * as Integration from "./integration.js"

import { Schema } from "effect"
import { optional } from "./schema.js"
import { define, inventory } from "./event.js"
import { Connection } from "./connection.js"
import { ascending } from "./identifier.js"
import { statics } from "./schema.js"
import { IntegrationID, IntegrationMethodID } from "./integration-id.js"
import { Form } from "./form.js"

export const ID = IntegrationID
export type ID = typeof ID.Type

export const MethodID = IntegrationMethodID
export type MethodID = typeof MethodID.Type

/** Fields authored for an Integration method, independently optional from a runtime Form request. */
export const MethodFormFields = Schema.NonEmptyArray(Form.Field).annotate({
  identifier: "Integration.MethodFormFields",
})
export type MethodFormFields = typeof MethodFormFields.Type
const OptionalMethodFormFields = optional(MethodFormFields)

export interface OAuthClientConfiguration extends Schema.Schema.Type<typeof OAuthClientConfiguration> {}
export const OAuthClientConfiguration = Schema.Struct({
  fields: Form.Fields,
  configured: Schema.Boolean,
}).annotate({ identifier: "Integration.OAuthClientConfiguration" })

export interface OAuthMethod extends Schema.Schema.Type<typeof OAuthMethod> {}
export const OAuthMethod = Schema.Struct({
  id: MethodID,
  type: Schema.Literal("oauth"),
  label: Schema.String,
  form: OptionalMethodFormFields,
  client: optional(OAuthClientConfiguration),
}).annotate({ identifier: "Integration.OAuthMethod" })

export interface CommandMethod extends Schema.Schema.Type<typeof CommandMethod> {}
export const CommandMethod = Schema.Struct({
  id: MethodID,
  type: Schema.Literal("command"),
  label: Schema.String,
  command: Schema.Array(Schema.String),
}).annotate({ identifier: "Integration.CommandMethod" })

export interface KeyMethod extends Schema.Schema.Type<typeof KeyMethod> {}
export const KeyMethod = Schema.Struct({
  type: Schema.Literal("key"),
  label: optional(Schema.String),
  form: OptionalMethodFormFields,
}).annotate({ identifier: "Integration.KeyMethod" })

export interface EnvMethod extends Schema.Schema.Type<typeof EnvMethod> {}
export const EnvMethod = Schema.Struct({
  type: Schema.Literal("env"),
  names: Schema.Array(Schema.String),
}).annotate({ identifier: "Integration.EnvMethod" })

export interface AwsSigV4Method extends Schema.Schema.Type<typeof AwsSigV4Method> {}
export const AwsSigV4Method = Schema.Struct({
  id: MethodID,
  type: Schema.Literal("aws-sigv4"),
  label: Schema.String,
  region: Form.StringField,
}).annotate({ identifier: "Integration.AwsSigV4Method" })

export interface EnvGroupMethod extends Schema.Schema.Type<typeof EnvGroupMethod> {}
export const EnvGroupMethod = Schema.Struct({
  id: MethodID,
  type: Schema.Literal("env-group"),
  authKind: Schema.Literals(["bedrock-bearer", "aws-sigv4"]),
  required: Schema.NonEmptyArray(Schema.String),
  optional: Schema.Array(Schema.String),
}).annotate({ identifier: "Integration.EnvGroupMethod" })

/** Named secret values each member supplies for themselves. */
export interface ValuesMethod extends Schema.Schema.Type<typeof ValuesMethod> {}
export const ValuesMethod = Schema.Struct({
  type: Schema.Literal("values"),
  label: Schema.String,
  fields: Schema.NonEmptyArray(Schema.String),
}).annotate({ identifier: "Integration.ValuesMethod" })

/** Public values-method projection: which names the current member has saved, never their values. */
export interface ValuesMethodInfo extends Schema.Schema.Type<typeof ValuesMethodInfo> {}
export const ValuesMethodInfo = Schema.Struct({
  ...ValuesMethod.fields,
  saved: Schema.Array(Schema.String),
}).annotate({ identifier: "Integration.ValuesMethodInfo" })

export const BedrockAwsSigV4MethodID = MethodID.make("bedrock-sigv4")
export const BedrockBearerEnvMethodID = MethodID.make("bedrock-bearer-env")
export const BedrockSigV4EnvMethodID = MethodID.make("bedrock-sigv4-env")

/** Declaration order is the deterministic environment fallback priority. */
export const BedrockEnvMethods = [
  EnvGroupMethod.make({
    id: BedrockBearerEnvMethodID,
    type: "env-group",
    authKind: "bedrock-bearer",
    required: ["AWS_BEARER_TOKEN_BEDROCK", "AWS_REGION"],
    optional: [],
  }),
  EnvGroupMethod.make({
    id: BedrockSigV4EnvMethodID,
    type: "env-group",
    authKind: "aws-sigv4",
    required: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
    optional: ["AWS_SESSION_TOKEN"],
  }),
] as const

export const Method = Schema.Union([
  OAuthMethod,
  CommandMethod,
  KeyMethod,
  EnvMethod,
  AwsSigV4Method,
  EnvGroupMethod,
  ValuesMethod,
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Integration.Method" })
export type Method = typeof Method.Type

export const Methods = Schema.Array(Method).check(
  Schema.makeFilter((methods) => {
    const identified = methods.filter((method) => "id" in method)
    const duplicate = identified.find(
      (method, index) => identified.findIndex((candidate) => candidate.id === method.id) !== index,
    )
    return duplicate === undefined ? undefined : `Duplicate integration method ID: ${duplicate.id}`
  }),
)

/** Public grouped-environment projection. Variable names remain an internal execution detail. */
export const EnvGroupMethodInfo = Schema.Struct({
  id: MethodID,
  type: Schema.Literal("env-group"),
  authKind: Schema.Literals(["bedrock-bearer", "aws-sigv4"]),
  available: Schema.Boolean,
}).annotate({ identifier: "Integration.EnvGroupMethodInfo" })
export interface EnvGroupMethodInfo extends Schema.Schema.Type<typeof EnvGroupMethodInfo> {}

export const MethodInfo = Schema.Union([
  OAuthMethod,
  CommandMethod,
  KeyMethod,
  EnvMethod,
  AwsSigV4Method,
  EnvGroupMethodInfo,
  ValuesMethodInfo,
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Integration.MethodInfo" })
export type MethodInfo = typeof MethodInfo.Type

const Updated = define("integration.updated", {})
const ConnectionUpdated = define("integration.connection.updated", { integrationID: ID })
export const Event = { Updated, ConnectionUpdated, Definitions: inventory(Updated, ConnectionUpdated) }

export const ConnectionPolicy = Schema.Literals(["member-only", "member-or-workspace"]).annotate({
  identifier: "Integration.ConnectionPolicy",
})
export type ConnectionPolicy = typeof ConnectionPolicy.Type

export interface Ref extends Schema.Schema.Type<typeof Ref> {}
export const Ref = Schema.Struct({
  id: ID,
  name: Schema.String,
  connectionPolicy: Schema.optionalKey(ConnectionPolicy),
}).annotate({ identifier: "Integration.Ref" })

export const Info = Schema.Struct({
  id: ID,
  name: Schema.String,
  connectionPolicy: Schema.optionalKey(ConnectionPolicy),
  methods: Schema.Array(MethodInfo),
  connections: Schema.Array(Connection.Info),
}).annotate({ identifier: "Integration.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const AttemptID = Schema.String.pipe(
  Schema.brand("Integration.AttemptID"),
  statics((schema) => ({ create: () => schema.make("con_" + ascending()) })),
)
export type AttemptID = typeof AttemptID.Type

const AttemptTime = Schema.Struct({
  created: Schema.Number,
  expires: Schema.Number,
})

export class Attempt extends Schema.Class<Attempt>("Integration.Attempt")({
  attemptID: AttemptID,
  url: Schema.String,
  instructions: Schema.String,
  mode: Schema.Literals(["auto", "code"]),
  time: AttemptTime,
}) {}

export const AttemptStatus = Schema.Union([
  Schema.Struct({ status: Schema.Literal("pending"), time: AttemptTime }),
  Schema.Struct({ status: Schema.Literal("complete"), time: AttemptTime }),
  Schema.Struct({ status: Schema.Literal("failed"), message: Schema.String, time: AttemptTime }),
  Schema.Struct({ status: Schema.Literal("expired"), time: AttemptTime }),
])
  .pipe(Schema.toTaggedUnion("status"))
  .annotate({ identifier: "Integration.AttemptStatus" })
export type AttemptStatus = typeof AttemptStatus.Type

export interface CommandAttempt extends Schema.Schema.Type<typeof CommandAttempt> {}
export const CommandAttempt = Schema.Struct({
  attemptID: AttemptID,
  time: AttemptTime,
}).annotate({ identifier: "Integration.CommandAttempt" })

export const CommandAttemptStatus = Schema.Union([
  Schema.Struct({ status: Schema.Literal("pending"), message: optional(Schema.String), time: AttemptTime }),
  Schema.Struct({ status: Schema.Literal("complete"), time: AttemptTime }),
  Schema.Struct({ status: Schema.Literal("failed"), message: Schema.String, time: AttemptTime }),
  Schema.Struct({ status: Schema.Literal("expired"), time: AttemptTime }),
])
  .pipe(Schema.toTaggedUnion("status"))
  .annotate({ identifier: "Integration.CommandAttemptStatus" })
export type CommandAttemptStatus = typeof CommandAttemptStatus.Type
