import type { ConnectionInfo } from "@bymorning/client"
import type { IntegrationApi } from "@bymorning/client/effect/api"
import { Credential } from "@bymorning/schema/credential"
import type { Integration } from "@bymorning/schema/integration"
import { Form } from "@bymorning/schema/form"
import type { Effect, Scope } from "effect"
import type { Transform } from "./registration.js"

type IntegrationRef = { id: string; name: string; connectionPolicy?: Integration.ConnectionPolicy }

export interface IntegrationOAuthMethod {
  readonly id: string
  readonly type: "oauth"
  readonly label: string
  readonly form?: Form.Fields
  readonly client?: Form.Fields
}

export interface IntegrationCommandMethod {
  readonly id: string
  readonly type: "command"
  readonly label: string
  readonly command: ReadonlyArray<string>
}

export interface IntegrationKeyMethod {
  readonly type: "key"
  readonly label?: string
  readonly form?: Form.Fields
}

export interface IntegrationEnvMethod {
  readonly type: "env"
  readonly names: ReadonlyArray<string>
}

/** Built-in AWS methods are visible to plugins but cannot be registered by them. */
export interface IntegrationAwsSigV4Method {
  readonly id: string
  readonly type: "aws-sigv4"
  readonly label: string
  readonly region: Form.StringField
}

/** Built-in grouped environment methods are visible to plugins but cannot be registered by them. */
export interface IntegrationEnvGroupMethod {
  readonly id: string
  readonly type: "env-group"
  readonly authKind: "bedrock-bearer" | "aws-sigv4"
  readonly available: boolean
}

export type IntegrationMethod =
  | IntegrationOAuthMethod
  | IntegrationCommandMethod
  | IntegrationKeyMethod
  | IntegrationEnvMethod
  | IntegrationAwsSigV4Method
  | IntegrationEnvGroupMethod

export type IntegrationOAuthAuthorization = {
  readonly url: string
  readonly instructions: string
  readonly expiresAt?: number
} & (
  | {
      readonly mode: "auto"
      readonly callback: Effect.Effect<Credential.OAuth, unknown>
    }
  | {
      readonly mode: "code"
      readonly callback: (code: string) => Effect.Effect<Credential.OAuth, unknown>
    }
)

export type IntegrationOAuthCallbackResponse =
  { readonly code: string } | { readonly error: string; readonly errorDescription?: string }

export interface IntegrationOAuthCallbackRegistration {
  readonly state: string
  readonly callbackURI: string
  readonly expiresAt: number
  readonly wait: Effect.Effect<IntegrationOAuthCallbackResponse>
}
export type IntegrationOAuthMethodRegistration = {
  readonly integrationID: string
  readonly method: IntegrationOAuthMethod
  readonly authorize: (
    answer: Form.Answer,
    clientAnswer: Form.Answer,
  ) => Effect.Effect<IntegrationOAuthAuthorization, unknown, Scope.Scope>
  readonly refresh?: (
    credential: Credential.OAuth,
    clientAnswer: Form.Answer,
  ) => Effect.Effect<Credential.OAuth, unknown>
  readonly label?: (credential: Credential.OAuth) => string | undefined
}
export type IntegrationMethodRegistration =
  | IntegrationOAuthMethodRegistration
  | {
      readonly integrationID: string
      readonly method: IntegrationCommandMethod
    }
  | {
      readonly integrationID: string
      readonly method: IntegrationKeyMethod
    }
  | {
      readonly integrationID: string
      readonly method: IntegrationEnvMethod
    }

export interface IntegrationEditor {
  list(): readonly IntegrationRef[]
  get(id: string): IntegrationRef | undefined
  update(id: string, update: (integration: IntegrationRef) => void): void
  remove(id: string): void
  readonly method: {
    list(integrationID: string): readonly IntegrationMethod[]
    update(input: IntegrationMethodRegistration): void
    remove(integrationID: string, method: IntegrationMethod): void
  }
}

export interface IntegrationDomain extends Omit<IntegrationApi<unknown>, "wellknown" | "oauth" | "connect"> {
  /** Member Values are entered only by the member through ByMorning, never by a plugin. */
  readonly connect: Omit<IntegrationApi<unknown>["connect"], "values">
  readonly transform: Transform<IntegrationEditor>
  readonly reload: () => Effect.Effect<void>
  readonly connection: {
    readonly active: (integrationID: string) => Effect.Effect<ConnectionInfo | undefined>
    readonly resolve: (connection: ConnectionInfo) => Effect.Effect<Credential.Value | undefined, unknown>
  }
  readonly oauth: Omit<IntegrationApi<unknown>["oauth"], "client"> & {
    readonly callback: {
      readonly register: () => Effect.Effect<IntegrationOAuthCallbackRegistration, never, Scope.Scope>
    }
  }
}
