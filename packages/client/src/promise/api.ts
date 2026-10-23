type Client = ReturnType<typeof import("./generated/client.js").make>

export type AuthApi = Client["auth"]
export type WorkspaceApi = Client["workspace"]
export type IntegrationApi = Client["integration"]
export type CredentialApi = Client["credential"]
export type WebSearchApi = Client["websearch"]
export type ModelApi = Client["model"]
export type ProviderApi = Client["provider"]
export interface CatalogApi {
  readonly provider: ProviderApi
  readonly model: Pick<ModelApi, "list">
}
export type ProjectApi = Client["project"]
export type SkillApi = Client["skill"]
export type CommandApi = Client["command"]
export type ReferenceApi = Client["reference"]
export type EventApi = Client["event"]
export type AgentApi = Client["agent"]
export type SessionApi = Client["session"]
export type ClientApi = Client
