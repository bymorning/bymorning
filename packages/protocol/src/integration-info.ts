import { Connection } from "@bymorning/schema/connection"
import { Form } from "@bymorning/schema/form"
import { Integration } from "@bymorning/schema/integration"
import { Schema } from "effect"

const AwsSigV4Method = Schema.Struct({
  id: Integration.MethodID,
  type: Schema.Literal("aws-sigv4"),
  label: Schema.String,
  region: Schema.Struct({ ...Form.StringField.fields }),
})

const MethodInfo = Schema.Union([
  Integration.OAuthMethod,
  Integration.CommandMethod,
  Integration.KeyMethod,
  Integration.EnvMethod,
  AwsSigV4Method,
  Integration.EnvGroupMethodInfo,
  Integration.ValuesMethodInfo,
]).annotate({ identifier: "Integration.MethodInfo" })

/** Transport-safe projection of Integration discovery information. */
export const IntegrationInfo = Schema.Struct({
  id: Integration.ID,
  name: Schema.String,
  connectionPolicy: Schema.optionalKey(Integration.ConnectionPolicy),
  methods: Schema.Array(MethodInfo),
  connections: Schema.Array(Connection.Info),
}).annotate({ identifier: "Integration.Info" })
