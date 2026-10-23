export * as Connection from "./connection.js"

import { Schema } from "effect"
import { Credential } from "./credential.js"
import { AwsRegion } from "./aws-region.js"

export interface CredentialInfo extends Schema.Schema.Type<typeof CredentialInfo> {}
export const CredentialInfo = Schema.Struct({
  type: Schema.Literal("credential"),
  id: Credential.ID,
  label: Schema.String,
  scope: Schema.optionalKey(Credential.Scope),
  active: Schema.optionalKey(Schema.Boolean),
}).annotate({ identifier: "Connection.CredentialInfo" })

export interface EnvInfo extends Schema.Schema.Type<typeof EnvInfo> {}
export const EnvInfo = Schema.Struct({
  type: Schema.Literal("env"),
  name: Schema.String,
}).annotate({ identifier: "Connection.EnvInfo" })

export interface RegionalCredentialInfo extends Schema.Schema.Type<typeof RegionalCredentialInfo> {}
export const RegionalCredentialInfo = Schema.Struct({
  type: Schema.Literal("regional-credential"),
  id: Credential.ID,
  label: Schema.String,
  scope: Schema.optionalKey(Credential.Scope),
  active: Schema.optionalKey(Schema.Boolean),
  authKind: Schema.Literals(["bearer", "sigv4"]),
  region: AwsRegion,
}).annotate({ identifier: "Connection.RegionalCredentialInfo" })

export interface RegionalEnvInfo extends Schema.Schema.Type<typeof RegionalEnvInfo> {}
export const RegionalEnvInfo = Schema.Struct({
  type: Schema.Literal("regional-env"),
  authKind: Schema.Literals(["bearer", "sigv4"]),
  region: AwsRegion,
}).annotate({ identifier: "Connection.RegionalEnvInfo" })

/** Secret-free native AWS credential-chain connection. */
export const Deployment = Schema.Struct({
  type: Schema.Literal("regional-deployment"),
  authKind: Schema.Literal("sigv4"),
  region: AwsRegion,
}).annotate({ identifier: "Connection.Deployment" })
/** Secret-free native AWS credential-chain connection. */
export interface Deployment extends Schema.Schema.Type<typeof Deployment> {}

export const Info = Schema.Union([CredentialInfo, EnvInfo, RegionalCredentialInfo, RegionalEnvInfo, Deployment])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Connection.Info" })
export type Info = typeof Info.Type
