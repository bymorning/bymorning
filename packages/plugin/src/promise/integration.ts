import type { ConnectionInfo } from "@bymorning/client"
import type { IntegrationApi } from "@bymorning/client/promise/api"
import { Credential } from "@bymorning/schema/credential"
import type { Integration } from "@bymorning/schema/integration"
import { Form } from "@bymorning/schema/form"
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
      readonly callback: Promise<Credential.OAuth>
    }
  | {
      readonly mode: "code"
      readonly callback: (code: string) => Promise<Credential.OAuth>
    }
)

export type IntegrationOAuthCallbackResponse =
  { readonly code: string } | { readonly error: string; readonly errorDescription?: string }

export interface IntegrationOAuthCallbackRegistration {
  readonly state: string
  readonly callbackURI: string
  readonly expiresAt: number
  readonly wait: Promise<IntegrationOAuthCallbackResponse>
}

export type IntegrationOAuthMethodRegistration = {
  readonly integrationID: string
  readonly method: IntegrationOAuthMethod
  readonly authorize: (answer: Form.Answer, clientAnswer: Form.Answer) => Promise<IntegrationOAuthAuthorization>
  readonly refresh?: (credential: Credential.OAuth, clientAnswer: Form.Answer) => Promise<Credential.OAuth>
  readonly label?: (credential: Credential.OAuth) => string | undefined
}

export type IntegrationMethodRegistration =
  | IntegrationOAuthMethodRegistration
  | { readonly integrationID: string; readonly method: IntegrationCommandMethod }
  | {
      readonly integrationID: string
      readonly method: IntegrationKeyMethod
    }
  | { readonly integrationID: string; readonly method: IntegrationEnvMethod }

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

export interface IntegrationDomain extends Omit<IntegrationApi, "wellknown" | "oauth" | "connect"> {
  /** Member Values are entered only by the member through ByMorning, never by a plugin. */
  readonly connect: Omit<IntegrationApi["connect"], "values">
  readonly transform: Transform<IntegrationEditor>
  readonly reload: () => Promise<void>
  readonly connection: {
    readonly active: (integrationID: string) => Promise<ConnectionInfo | undefined>
    readonly resolve: (connection: ConnectionInfo) => Promise<Credential.Value | undefined>
  }
  readonly oauth: Omit<IntegrationApi["oauth"], "client"> & {
    readonly callback: {
      readonly register: () => Promise<IntegrationOAuthCallbackRegistration>
    }
  }
}
