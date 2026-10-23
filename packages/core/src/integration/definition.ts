import { Credential } from "@bymorning/schema/credential"
import { Form } from "@bymorning/schema/form"
import { Integration } from "@bymorning/schema/integration"
import { optional } from "@bymorning/schema/schema"
import { Effect, Schema, Scope } from "effect"

export const OAuthMethodDefinition = Schema.Struct({
  id: Integration.MethodID,
  type: Schema.Literal("oauth"),
  label: Schema.String,
  form: optional(Form.Fields),
  client: optional(Form.Fields),
}).annotate({ identifier: "Integration.OAuthMethodDefinition" })
export type OAuthMethodDefinition = typeof OAuthMethodDefinition.Type

export const CommandMethodDefinition = Integration.CommandMethod
export type CommandMethodDefinition = Integration.CommandMethod
export const KeyMethodDefinition = Integration.KeyMethod
export type KeyMethodDefinition = Integration.KeyMethod
export const EnvMethodDefinition = Integration.EnvMethod
export type EnvMethodDefinition = Integration.EnvMethod
export const AwsSigV4MethodDefinition = Integration.AwsSigV4Method
export type AwsSigV4MethodDefinition = Integration.AwsSigV4Method
export const EnvGroupMethodDefinition = Integration.EnvGroupMethod
export type EnvGroupMethodDefinition = Integration.EnvGroupMethod
export const ValuesMethodDefinition = Integration.ValuesMethod
export type ValuesMethodDefinition = Integration.ValuesMethod

export const MethodDefinition = Schema.Union([
  OAuthMethodDefinition,
  CommandMethodDefinition,
  KeyMethodDefinition,
  EnvMethodDefinition,
  AwsSigV4MethodDefinition,
  EnvGroupMethodDefinition,
  ValuesMethodDefinition,
]).pipe(Schema.toTaggedUnion("type"))
export type MethodDefinition = typeof MethodDefinition.Type

export const MethodSelector = Schema.Union([
  Schema.Struct({ type: Schema.Literal("oauth"), id: Integration.MethodID }),
  Schema.Struct({ type: Schema.Literal("command"), id: Integration.MethodID }),
  Schema.Struct({ type: Schema.Literal("key") }),
  Schema.Struct({ type: Schema.Literal("env") }),
  Schema.Struct({ type: Schema.Literal("aws-sigv4"), id: Integration.MethodID }),
  Schema.Struct({ type: Schema.Literal("env-group"), id: Integration.MethodID }),
  Schema.Struct({ type: Schema.Literal("values") }),
])
export type MethodSelector = typeof MethodSelector.Type

export type OAuthAuthorization = {
  readonly url: string
  readonly instructions: string
  readonly expiresAt?: number
} & (
  | { readonly mode: "auto"; readonly callback: Effect.Effect<Credential.OAuth, unknown> }
  | { readonly mode: "code"; readonly callback: (code: string) => Effect.Effect<Credential.OAuth, unknown> }
)

export interface OAuthImplementation {
  readonly integrationID: Integration.ID
  readonly method: OAuthMethodDefinition
  readonly authorize: (
    answer: Form.Answer,
    clientAnswer: Form.Answer,
  ) => Effect.Effect<OAuthAuthorization, unknown, Scope.Scope>
  readonly refresh?: (
    credential: Credential.OAuth,
    clientAnswer: Form.Answer,
  ) => Effect.Effect<Credential.OAuth, unknown>
  readonly label?: (credential: Credential.OAuth) => string | undefined
}

export interface CommandImplementation {
  readonly integrationID: Integration.ID
  readonly method: CommandMethodDefinition
}
export interface KeyImplementation {
  readonly integrationID: Integration.ID
  readonly method: KeyMethodDefinition
}
export interface EnvImplementation {
  readonly integrationID: Integration.ID
  readonly method: EnvMethodDefinition
}
export interface AwsSigV4Implementation {
  readonly integrationID: Integration.ID
  readonly method: AwsSigV4MethodDefinition
}
export interface EnvGroupImplementation {
  readonly integrationID: Integration.ID
  readonly method: EnvGroupMethodDefinition
}
export interface ValuesImplementation {
  readonly integrationID: Integration.ID
  readonly method: ValuesMethodDefinition
}
export type Implementation =
  | OAuthImplementation
  | CommandImplementation
  | KeyImplementation
  | EnvImplementation
  | AwsSigV4Implementation
  | EnvGroupImplementation
  | ValuesImplementation
