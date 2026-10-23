import type * as Brand from "effect/Brand"

export type JsonValue = null | boolean | number | string | Array<JsonValue> | { [key: string]: JsonValue }

export type AuthProviderInfo = {
  id: string & Brand.Brand<"AuthProvider.ID">
  revision: number & Brand.Brand<"AuthProvider.Revision">
  displayName: string
  kind: "google" | "okta" | "microsoft" | "auth0" | "ping" | "custom"
  domains: [string, ...Array<string>]
  issuer: string
  clientID: string
  status: "enabled" | "disabled"
}

export type PromptMention = { start: number; end: number; text: string }

export type SessionInboxDelivery = "steer" | "queue"

export type AccountSessionInfo = {
  id: string & Brand.Brand<"Auth.SessionID">
  createdAt: string
  activeAt: string
  idleUntil: string
  expiresAt: string
  current: boolean
}

export type AccountGrantInfo = {
  id: string & Brand.Brand<"OAuthGrant.ID">
  clientID: string & Brand.Brand<"OAuthClient.ID">
  clientName: string
  createdAt: string
  updatedAt: string
  expiresAt: string
}

export type WorkspaceAccessInfo = {
  id: string & Brand.Brand<"Workspace.ID">
  name: string
  status: "active" | "suspended"
  role: "admin" | "member"
}

export type InstallationSelf = { admin: boolean }

export type InstallationAdminList = { admins: Array<string & Brand.Brand<"Account.ID">> }

export type AwsPartition = "aws" | "aws-us-gov"

export type IntegrationConnectionPolicy = "member-only" | "member-or-workspace"

export type FormWhen = { key: string; op: "eq" | "neq"; value: string | number | boolean }

export type FormOption = { value: string; label: string; description?: string | undefined }

export type FormExternalField = {
  key: string
  type: "external"
  url: string
  title?: string | undefined
  description?: string | undefined
}

export type IntegrationCommandMethod = {
  id: string & Brand.Brand<"Integration.MethodID">
  type: "command"
  label: string
  command: Array<string>
}

export type IntegrationEnvMethod = { type: "env"; names: Array<string> }

export type IntegrationEnvGroupMethodInfo = {
  id: string & Brand.Brand<"Integration.MethodID">
  type: "env-group"
  authKind: "bedrock-bearer" | "aws-sigv4"
  available: boolean
}

export type IntegrationValuesMethodInfo = {
  type: "values"
  label: string
  fields: [string, ...Array<string>]
  saved: Array<string>
}

export type CredentialScope = "member" | "workspace"

export type ConnectionEnvInfo = { type: "env"; name: string }

export type ConnectionRegionalEnvInfo = {
  type: "regional-env"
  authKind: "bearer" | "sigv4"
  region: string & Brand.Brand<"AwsRegion">
}

export type ConnectionDeployment = {
  type: "regional-deployment"
  authKind: "sigv4"
  region: string & Brand.Brand<"AwsRegion">
}

export type PermissionEffect = "allow" | "deny" | "ask"

export type ConfigPluginEntry = { package: string; options?: { [x: string]: any } | undefined }

export type ConfigWebSearchInfo = { provider: "random" | ((string & {}) & Brand.Brand<"WebSearch.ID">) }

export type ModelCustom = {
  provider: string & Brand.Brand<"Provider.Name">
  id: string
  name: string
  apiID: string
  cost?: { input?: number; output?: number }
  limit?: { context?: number }
}

export type ScheduledTaskInfo = {
  id: string & Brand.Brand<"ScheduledTask.ID">
  name: string
  prompt: string
  cron: string
  timezone: string
  projectID: string & Brand.Brand<"Project.ID">
  model?: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
  enabled: boolean
  nextRunAt?: globalThis.Date
  lastRunAt?: globalThis.Date
  lastSessionID?: string & Brand.Brand<"Session.ID">
  lastNote?: string
  missedAt?: globalThis.Date
  createdAt: globalThis.Date
  updatedAt: globalThis.Date
}

export type SessionInfo = {
  id: string & Brand.Brand<"Session.ID">
  projectID: string & Brand.Brand<"Project.ID">
  parentID?: string & Brand.Brand<"Session.ID">
  title: string
  archivedAt?: globalThis.Date
  agent: string & Brand.Brand<"Agent.ID">
  model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
  scheduledTaskID?: string & Brand.Brand<"ScheduledTask.ID">
  createdAt: globalThis.Date
  updatedAt: globalThis.Date
}

export type PolicyHeaderValue = string | { env: string }

export type PolicyPurpose = "assistant" | "generate" | "compaction" | "title"

export type PolicyRegex = { pattern: string; flags?: string }

export type PolicyInstructionRule = { type: "instruction"; model: string; agent?: string; text: string }

export type PluginSource =
  | { type: "builtin" }
  | { type: "package"; package: string; version?: string; outdated?: true; updating?: true }
  | { type: "local"; path: string }
  | { type: "sdk" }
  | {
      type: "project"
      projectID: string & Brand.Brand<"Project.ID">
      path?: string & Brand.Brand<"ProjectDirectory.Path">
    }

export type PolicyRuleType =
  "guardrail" | "route" | "endpoint" | "escalate" | "tool.input" | "tool.output" | "instruction" | "prompt"

export type CommandInfo = {
  name: string
  template: string
  description?: string | undefined
  agent?: (string & Brand.Brand<"Agent.ID">) | undefined
  model?: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string } | undefined
  subtask?: boolean | undefined
}

export type ToolUsageListRecord = {
  id: string & Brand.Brand<"ToolUsage.ID">
  userID: string & Brand.Brand<"User.ID">
  sessionID: (string & Brand.Brand<"Session.ID">) | null
  tool: string
  status: "completed" | "error"
  occurredAt: globalThis.Date
}

export type ModelInfo = {
  id: string
  provider: string & Brand.Brand<"Provider.Name">
  apiID: string
  name: string
  description: string
  family?: string
  status: "alpha" | "beta" | "deprecated" | "active"
  releaseDate: string
  lastUpdated: string
  openWeights?: boolean | undefined
  capabilities: {
    temperature?: boolean
    reasoning?: boolean
    attachment?: boolean
    tools?: boolean
    input: Array<string>
    output: Array<string>
  }
  variants: Array<string>
  limit: { context?: number; input?: number; output?: number }
  cost: {
    input?: number
    output?: number
    cache: { read?: number; write?: number }
    tiers?: Array<{
      input?: number
      output?: number
      cache: { read?: number; write?: number }
      tier: { type: "context"; size: number }
    }>
    experimentalOver200K?: { input?: number; output?: number; cache: { read?: number; write?: number } }
  }
}

export type ModelRoutePreview = {
  model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
  route: {
    cause: "none" | "rule" | "judge" | "pinned" | "fallback"
    rule?: number
    tier?: string
    fallback?: "timeout" | "invalid" | "unavailable" | "error" | "unpinned"
  }
  judge?: { model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }; cost?: number }
}

export type IntegrationAttempt = {
  attemptID: string & Brand.Brand<"Integration.AttemptID">
  url: string
  instructions: string
  mode: "auto" | "code"
  time: { created: number; expires: number }
}

export type IntegrationAttemptStatus =
  | { status: "pending"; time: { created: number; expires: number } }
  | { status: "complete"; time: { created: number; expires: number } }
  | { status: "failed"; message: string; time: { created: number; expires: number } }
  | { status: "expired"; time: { created: number; expires: number } }

export type IntegrationCommandAttempt = {
  attemptID: string & Brand.Brand<"Integration.AttemptID">
  time: { created: number; expires: number }
}

export type IntegrationCommandAttemptStatus =
  | { status: "pending"; message?: string | undefined; time: { created: number; expires: number } }
  | { status: "complete"; time: { created: number; expires: number } }
  | { status: "failed"; message: string; time: { created: number; expires: number } }
  | { status: "expired"; time: { created: number; expires: number } }

export type WebSearchProvider = { id: string & Brand.Brand<"WebSearch.ID">; name: string }

export type WebSearchResult = {
  url: string
  title?: string | undefined
  content?: string | undefined
  time: { published?: number | undefined }
}

export type SessionActive = { type: "running" }

export type SessionDetail = {
  id: string & Brand.Brand<"Session.ID">
  projectID: string & Brand.Brand<"Project.ID">
  parentID?: string & Brand.Brand<"Session.ID">
  title: string
  archivedAt?: globalThis.Date
  agent: string & Brand.Brand<"Agent.ID">
  model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
  scheduledTaskID?: string & Brand.Brand<"ScheduledTask.ID">
  createdAt: globalThis.Date
  updatedAt: globalThis.Date
  usage: {
    cost: number
    costComplete: boolean
    tokens: { total?: number; input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  }
}

export type SessionInboxSyntheticPayload = { text: string; description?: string; metadata?: { [x: string]: JsonValue } }

export type SessionInboxCompactionPayload = {}

export type InstructionEntryKey = string

export type FormMetadata = { [x: string]: any }

export type FormValue = string | number | boolean | Array<string>

export type AgentColor = string

export type PermissionRequest = {
  id: string & Brand.Brand<"Permission.ID">
  sessionID: string & Brand.Brand<"Session.ID">
  action: string
  resources: Array<string>
  save?: Array<string> | undefined
  metadata?: { [x: string]: JsonValue }
  source?: { type: "tool"; messageID: string & Brand.Brand<"Message.ID">; callID: string } | undefined
}

export type PromptAgentAttachment = { name: string; mention?: PromptMention }

export type ProviderEndpointStrategy =
  | { _tag: "fixed"; api: string & Brand.Brand<"Provider.API"> }
  | { _tag: "aws-regional"; partitions: [AwsPartition, ...Array<AwsPartition>] }

export type FormNumberField = {
  key: string
  title?: string | undefined
  description?: string | undefined
  required?: boolean | undefined
  when?: Array<FormWhen> | undefined
  type: "number"
  minimum?: number | undefined
  maximum?: number | undefined
  default?: number | undefined
}

export type FormIntegerField = {
  key: string
  title?: string | undefined
  description?: string | undefined
  required?: boolean | undefined
  when?: Array<FormWhen> | undefined
  type: "integer"
  minimum?: number | undefined
  maximum?: number | undefined
  default?: number | undefined
}

export type FormBooleanField = {
  key: string
  title?: string | undefined
  description?: string | undefined
  required?: boolean | undefined
  when?: Array<FormWhen> | undefined
  type: "boolean"
  default?: boolean | undefined
}

export type FormStringField = {
  key: string
  title?: string | undefined
  description?: string | undefined
  required?: boolean | undefined
  when?: Array<FormWhen> | undefined
  type: "string"
  secret?: boolean | undefined
  multiline?: boolean | undefined
  format?: "email" | "uri" | "date" | "date-time" | undefined
  minLength?: number | undefined
  maxLength?: number | undefined
  pattern?: string | undefined
  placeholder?: string | undefined
  default?: string | undefined
  options?: Array<FormOption> | undefined
  custom?: boolean | undefined
}

export type FormMultiselectField = {
  key: string
  title?: string | undefined
  description?: string | undefined
  required?: boolean | undefined
  when?: Array<FormWhen> | undefined
  type: "multiselect"
  options: Array<FormOption>
  minItems?: number | undefined
  maxItems?: number | undefined
  custom?: boolean | undefined
  default?: Array<string> | undefined
}

export type ConnectionCredentialInfo = {
  type: "credential"
  id: string & Brand.Brand<"Credential.ID">
  label: string
  scope?: CredentialScope
  active?: boolean
}

export type ConnectionRegionalCredentialInfo = {
  type: "regional-credential"
  id: string & Brand.Brand<"Credential.ID">
  label: string
  scope?: CredentialScope
  active?: boolean
  authKind: "bearer" | "sigv4"
  region: string & Brand.Brand<"AwsRegion">
}

export type PermissionRule = {
  action: string
  resource: string
  effect: PermissionEffect
  user?: (string & Brand.Brand<"User.ID">) | undefined
}

export type SessionPage = { data: Array<SessionInfo>; cursor?: string }

export type PolicyEndpointRule = {
  type: "endpoint"
  model: string
  baseURL?: string
  headers?: { [x: string]: PolicyHeaderValue }
}

export type PolicyEscalateRule = { type: "escalate"; tool: string; target: string; purpose?: Array<PolicyPurpose> }

export type PolicyToolInputRule = {
  type: "tool.input"
  tool: string
  path?: string
  match: PolicyRegex
  message?: string
}

export type PolicyToolOutputRule = { type: "tool.output"; tool: string; match: PolicyRegex; replacement: string }

export type PolicyPromptRule = { type: "prompt"; match: PolicyRegex; replacement: string }

export type PolicySource = { type: "plugin"; pluginID: string & Brand.Brand<"Plugin.ID">; pluginSource: PluginSource }

export type PolicyTrace = { policyID: string; rule: number; type: PolicyRuleType; matched: boolean; selected: boolean }

export type ToolUsagePage = { data: Array<ToolUsageListRecord>; cursor?: string }

export type ModelManagement = {
  info: ModelInfo
  enabled: boolean
  isPreferredDefault: boolean
  isEffectiveDefault: boolean
  unavailableReason?:
    | "provider-inactive"
    | "provider-disabled"
    | "region-unsupported"
    | "transport-unsupported"
    | "connection-unavailable"
  custom?: boolean
}

export type WebSearchResponse = { providerID: string & Brand.Brand<"WebSearch.ID">; results: Array<WebSearchResult> }

export type SessionActiveMap = { [x: string]: SessionActive }

export type SessionInboxSynthetic = {
  id: string & Brand.Brand<"Message.ID">
  sessionID: string & Brand.Brand<"Session.ID">
  createdAt: globalThis.Date
  type: "synthetic"
  payload: SessionInboxSyntheticPayload
  delivery: SessionInboxDelivery
}

export type InstructionEntryInfo = { key: InstructionEntryKey; value: JsonValue }

export type FormAnswer = { [x: string]: FormValue }

export type ShareView = {
  workspaceID: string & Brand.Brand<"Workspace.ID">
  sessionID: string & Brand.Brand<"Session.ID">
  title: string
  token: string & Brand.Brand<"Share.Token">
  createdAt: globalThis.Date
  messages: Array<
    | {
        id: string & Brand.Brand<"Message.ID">
        sessionID: string & Brand.Brand<"Session.ID">
        sequence: number
        createdAt: globalThis.Date
        type: "user"
        text: string
        agents?: Array<PromptAgentAttachment>
        metadata?: { [x: string]: any }
        delivery?: SessionInboxDelivery
        admittedSequence: number
      }
    | {
        id: string & Brand.Brand<"Message.ID">
        sessionID: string & Brand.Brand<"Session.ID">
        sequence: number
        createdAt: globalThis.Date
        type: "synthetic"
        text: string
        description?: string
        metadata?: { [x: string]: JsonValue }
      }
    | {
        id: string & Brand.Brand<"Message.ID">
        sessionID: string & Brand.Brand<"Session.ID">
        sequence: number
        createdAt: globalThis.Date
        type: "system"
        text: string
        description?: string
      }
    | {
        id: string & Brand.Brand<"Message.ID">
        sessionID: string & Brand.Brand<"Session.ID">
        sequence: number
        createdAt: globalThis.Date
        type: "assistant"
        agent?: string & Brand.Brand<"Agent.ID">
        model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
        requestedModel?: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
        route?: {
          cause: "none" | "rule" | "judge" | "pinned" | "fallback"
          rule?: number
          tier?: string
          fallback?: "timeout" | "invalid" | "unavailable" | "error" | "unpinned"
        }
        content: Array<
          | {
              type: "text"
              id: string
              text: string
              providerExecuted?: boolean
              providerMetadata?: { [x: string]: JsonValue }
            }
          | {
              type: "reasoning"
              id: string
              text: string
              providerExecuted?: boolean
              providerMetadata?: { [x: string]: JsonValue }
              time?: { created: globalThis.Date; completed?: globalThis.Date }
            }
          | {
              type: "tool"
              id: string
              name: string
              state:
                | { status: "streaming"; input: string }
                | { status: "running"; input: { [x: string]: JsonValue }; metadata?: { [x: string]: JsonValue } }
                | {
                    status: "completed"
                    input: { [x: string]: JsonValue }
                    content: Array<
                      | { type: "text"; text: string }
                      | { type: "file"; uri: string; mime: string; name?: string | undefined }
                    >
                    result?: JsonValue
                    metadata?: { [x: string]: JsonValue }
                  }
                | {
                    status: "error"
                    input: { [x: string]: JsonValue }
                    error:
                      | { _tag: "SessionError.AbortedError"; message: string }
                      | {
                          _tag: "SessionError.ProviderError"
                          message: string
                          category?:
                            | "auth"
                            | "rate-limit"
                            | "quota"
                            | "content-filter"
                            | "transport"
                            | "internal"
                            | "invalid-request"
                            | "context-overflow"
                            | "unknown"
                          status?: number
                          provider?: string
                          model?: string
                          requestID?: string
                          responseBody?: string
                          bodyTruncated?: boolean
                        }
                      | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
                      | { _tag: "SessionError.InternalError"; message: string }
                    metadata?: { [x: string]: JsonValue }
                  }
              providerExecuted?: boolean
              providerMetadata?: { [x: string]: JsonValue }
              time: { created: globalThis.Date; ran?: globalThis.Date; completed?: globalThis.Date }
            }
        >
        finish?: "length" | "stop" | "tool-calls" | "content-filter" | "error" | "unknown"
        error?:
          | { _tag: "SessionError.AbortedError"; message: string }
          | {
              _tag: "SessionError.ProviderError"
              message: string
              category?:
                | "auth"
                | "rate-limit"
                | "quota"
                | "content-filter"
                | "transport"
                | "internal"
                | "invalid-request"
                | "context-overflow"
                | "unknown"
              status?: number
              provider?: string
              model?: string
              requestID?: string
              responseBody?: string
              bodyTruncated?: boolean
            }
          | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
          | { _tag: "SessionError.InternalError"; message: string }
        time: { created: globalThis.Date; streamed?: globalThis.Date; completed?: globalThis.Date }
        retry?: {
          attempt: number
          at: globalThis.Date
          error:
            | { _tag: "SessionError.AbortedError"; message: string }
            | {
                _tag: "SessionError.ProviderError"
                message: string
                category?:
                  | "auth"
                  | "rate-limit"
                  | "quota"
                  | "content-filter"
                  | "transport"
                  | "internal"
                  | "invalid-request"
                  | "context-overflow"
                  | "unknown"
                status?: number
                provider?: string
                model?: string
                requestID?: string
                responseBody?: string
                bodyTruncated?: boolean
              }
            | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
            | { _tag: "SessionError.InternalError"; message: string }
        }
        usage?: {
          cost: number
          costComplete: boolean
          tokens: {
            total?: number
            input: number
            output: number
            reasoning: number
            cache: { read: number; write: number }
          }
        }
      }
    | {
        id: string & Brand.Brand<"Message.ID">
        sessionID: string & Brand.Brand<"Session.ID">
        sequence: number
        createdAt: globalThis.Date
        type: "agent-switched"
        agent: string & Brand.Brand<"Agent.ID">
      }
    | {
        id: string & Brand.Brand<"Message.ID">
        sessionID: string & Brand.Brand<"Session.ID">
        sequence: number
        createdAt: globalThis.Date
        type: "model-switched"
        model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
      }
    | {
        id: string & Brand.Brand<"Message.ID">
        sessionID: string & Brand.Brand<"Session.ID">
        sequence: number
        createdAt: globalThis.Date
        type: "compaction"
        reason: "manual" | "auto"
        status: "running"
        summary: string
        recent: string
      }
    | {
        id: string & Brand.Brand<"Message.ID">
        sessionID: string & Brand.Brand<"Session.ID">
        sequence: number
        createdAt: globalThis.Date
        type: "compaction"
        reason: "manual" | "auto"
        status: "completed"
        summary: string
        recent: string
      }
    | {
        id: string & Brand.Brand<"Message.ID">
        sessionID: string & Brand.Brand<"Session.ID">
        sequence: number
        createdAt: globalThis.Date
        type: "compaction"
        reason: "manual" | "auto"
        status: "failed"
        error:
          | { _tag: "SessionError.AbortedError"; message: string }
          | {
              _tag: "SessionError.ProviderError"
              message: string
              category?:
                | "auth"
                | "rate-limit"
                | "quota"
                | "content-filter"
                | "transport"
                | "internal"
                | "invalid-request"
                | "context-overflow"
                | "unknown"
              status?: number
              provider?: string
              model?: string
              requestID?: string
              responseBody?: string
              bodyTruncated?: boolean
            }
          | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
          | { _tag: "SessionError.InternalError"; message: string }
      }
  >
}

export type SessionInboxUserPayload = {
  text: string
  agents?: Array<PromptAgentAttachment>
  metadata?: { [x: string]: any }
}

export type MessageListResponse = {
  data: Array<
    | {
        id: string & Brand.Brand<"Message.ID">
        sessionID: string & Brand.Brand<"Session.ID">
        sequence: number
        createdAt: globalThis.Date
        type: "user"
        text: string
        agents?: Array<PromptAgentAttachment>
        metadata?: { [x: string]: any }
        delivery?: SessionInboxDelivery
        admittedSequence: number
      }
    | {
        id: string & Brand.Brand<"Message.ID">
        sessionID: string & Brand.Brand<"Session.ID">
        sequence: number
        createdAt: globalThis.Date
        type: "synthetic"
        text: string
        description?: string
        metadata?: { [x: string]: JsonValue }
      }
    | {
        id: string & Brand.Brand<"Message.ID">
        sessionID: string & Brand.Brand<"Session.ID">
        sequence: number
        createdAt: globalThis.Date
        type: "system"
        text: string
        description?: string
      }
    | {
        id: string & Brand.Brand<"Message.ID">
        sessionID: string & Brand.Brand<"Session.ID">
        sequence: number
        createdAt: globalThis.Date
        type: "assistant"
        agent?: string & Brand.Brand<"Agent.ID">
        model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
        requestedModel?: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
        route?: {
          cause: "none" | "rule" | "judge" | "pinned" | "fallback"
          rule?: number
          tier?: string
          fallback?: "timeout" | "invalid" | "unavailable" | "error" | "unpinned"
        }
        content: Array<
          | {
              type: "text"
              id: string
              text: string
              providerExecuted?: boolean
              providerMetadata?: { [x: string]: JsonValue }
            }
          | {
              type: "reasoning"
              id: string
              text: string
              providerExecuted?: boolean
              providerMetadata?: { [x: string]: JsonValue }
              time?: { created: globalThis.Date; completed?: globalThis.Date }
            }
          | {
              type: "tool"
              id: string
              name: string
              state:
                | { status: "streaming"; input: string }
                | { status: "running"; input: { [x: string]: JsonValue }; metadata?: { [x: string]: JsonValue } }
                | {
                    status: "completed"
                    input: { [x: string]: JsonValue }
                    content: Array<
                      | { type: "text"; text: string }
                      | { type: "file"; uri: string; mime: string; name?: string | undefined }
                    >
                    result?: JsonValue
                    metadata?: { [x: string]: JsonValue }
                  }
                | {
                    status: "error"
                    input: { [x: string]: JsonValue }
                    error:
                      | { _tag: "SessionError.AbortedError"; message: string }
                      | {
                          _tag: "SessionError.ProviderError"
                          message: string
                          category?:
                            | "auth"
                            | "rate-limit"
                            | "quota"
                            | "content-filter"
                            | "transport"
                            | "internal"
                            | "invalid-request"
                            | "context-overflow"
                            | "unknown"
                          status?: number
                          provider?: string
                          model?: string
                          requestID?: string
                          responseBody?: string
                          bodyTruncated?: boolean
                        }
                      | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
                      | { _tag: "SessionError.InternalError"; message: string }
                    metadata?: { [x: string]: JsonValue }
                  }
              providerExecuted?: boolean
              providerMetadata?: { [x: string]: JsonValue }
              time: { created: globalThis.Date; ran?: globalThis.Date; completed?: globalThis.Date }
            }
        >
        finish?: "length" | "stop" | "tool-calls" | "content-filter" | "error" | "unknown"
        error?:
          | { _tag: "SessionError.AbortedError"; message: string }
          | {
              _tag: "SessionError.ProviderError"
              message: string
              category?:
                | "auth"
                | "rate-limit"
                | "quota"
                | "content-filter"
                | "transport"
                | "internal"
                | "invalid-request"
                | "context-overflow"
                | "unknown"
              status?: number
              provider?: string
              model?: string
              requestID?: string
              responseBody?: string
              bodyTruncated?: boolean
            }
          | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
          | { _tag: "SessionError.InternalError"; message: string }
        time: { created: globalThis.Date; streamed?: globalThis.Date; completed?: globalThis.Date }
        retry?: {
          attempt: number
          at: globalThis.Date
          error:
            | { _tag: "SessionError.AbortedError"; message: string }
            | {
                _tag: "SessionError.ProviderError"
                message: string
                category?:
                  | "auth"
                  | "rate-limit"
                  | "quota"
                  | "content-filter"
                  | "transport"
                  | "internal"
                  | "invalid-request"
                  | "context-overflow"
                  | "unknown"
                status?: number
                provider?: string
                model?: string
                requestID?: string
                responseBody?: string
                bodyTruncated?: boolean
              }
            | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
            | { _tag: "SessionError.InternalError"; message: string }
        }
        usage?: {
          cost: number
          costComplete: boolean
          tokens: {
            total?: number
            input: number
            output: number
            reasoning: number
            cache: { read: number; write: number }
          }
        }
      }
    | {
        id: string & Brand.Brand<"Message.ID">
        sessionID: string & Brand.Brand<"Session.ID">
        sequence: number
        createdAt: globalThis.Date
        type: "agent-switched"
        agent: string & Brand.Brand<"Agent.ID">
      }
    | {
        id: string & Brand.Brand<"Message.ID">
        sessionID: string & Brand.Brand<"Session.ID">
        sequence: number
        createdAt: globalThis.Date
        type: "model-switched"
        model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
      }
    | {
        id: string & Brand.Brand<"Message.ID">
        sessionID: string & Brand.Brand<"Session.ID">
        sequence: number
        createdAt: globalThis.Date
        type: "compaction"
        reason: "manual" | "auto"
        status: "running"
        summary: string
        recent: string
      }
    | {
        id: string & Brand.Brand<"Message.ID">
        sessionID: string & Brand.Brand<"Session.ID">
        sequence: number
        createdAt: globalThis.Date
        type: "compaction"
        reason: "manual" | "auto"
        status: "completed"
        summary: string
        recent: string
      }
    | {
        id: string & Brand.Brand<"Message.ID">
        sessionID: string & Brand.Brand<"Session.ID">
        sequence: number
        createdAt: globalThis.Date
        type: "compaction"
        reason: "manual" | "auto"
        status: "failed"
        error:
          | { _tag: "SessionError.AbortedError"; message: string }
          | {
              _tag: "SessionError.ProviderError"
              message: string
              category?:
                | "auth"
                | "rate-limit"
                | "quota"
                | "content-filter"
                | "transport"
                | "internal"
                | "invalid-request"
                | "context-overflow"
                | "unknown"
              status?: number
              provider?: string
              model?: string
              requestID?: string
              responseBody?: string
              bodyTruncated?: boolean
            }
          | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
          | { _tag: "SessionError.InternalError"; message: string }
      }
  >
  cursor: { previous?: string; next?: string }
}

export type ProviderInfo = {
  name: string & Brand.Brand<"Provider.Name">
  displayName?: string
  api?: string & Brand.Brand<"Provider.API">
  endpointStrategy?: ProviderEndpointStrategy
  format: "anthropic" | "bedrock-converse" | "google" | "openai" | "oa-compat"
  status: "auto" | "enabled" | "disabled"
}

export type FormField =
  FormStringField | FormNumberField | FormIntegerField | FormBooleanField | FormMultiselectField | FormExternalField

export type ConnectionInfo =
  | ConnectionCredentialInfo
  | ConnectionEnvInfo
  | ConnectionRegionalCredentialInfo
  | ConnectionRegionalEnvInfo
  | ConnectionDeployment

export type PermissionRuleset = Array<PermissionRule>

export type PolicyRule =
  | { type: "guardrail"; action: string; resource: string; effect: "allow" }
  | { type: "guardrail"; action: string; resource: string; effect: "deny"; message?: string }
  | { type: "route"; action: "model.request" | "provider.request"; resource: string; target: string }
  | PolicyEndpointRule
  | PolicyEscalateRule
  | PolicyToolInputRule
  | PolicyToolOutputRule
  | PolicyInstructionRule
  | PolicyPromptRule

export type InstructionEntryListResponse = { data: Array<InstructionEntryInfo> }

export type FormState = { status: "pending" } | { status: "answered"; answer: FormAnswer } | { status: "cancelled" }

export type SessionInboxInfo =
  | {
      id: string & Brand.Brand<"Message.ID">
      sessionID: string & Brand.Brand<"Session.ID">
      admittedSequence: number
      createdAt: globalThis.Date
      type: "user"
      payload: SessionInboxUserPayload
      delivery: SessionInboxDelivery
    }
  | {
      id: string & Brand.Brand<"Message.ID">
      sessionID: string & Brand.Brand<"Session.ID">
      admittedSequence: number
      createdAt: globalThis.Date
      type: "synthetic"
      payload: SessionInboxSyntheticPayload
      delivery: SessionInboxDelivery
    }
  | {
      id: string & Brand.Brand<"Message.ID">
      sessionID: string & Brand.Brand<"Session.ID">
      admittedSequence: number
      createdAt: globalThis.Date
      type: "compaction"
      payload: SessionInboxCompactionPayload
      delivery: SessionInboxDelivery
    }

export type IntegrationMethodFormFields = [FormField, ...Array<FormField>]

export type FormFields = [FormField, ...Array<FormField>]

export type AgentInfo = {
  id: string & Brand.Brand<"Agent.ID">
  name: string & Brand.Brand<"Agent.Name">
  instructions: string
  model?: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
  description?: string
  mode: "subagent" | "primary" | "all"
  hidden: boolean
  color?: AgentColor
  steps: number | null
  permissions: PermissionRuleset
  overridden?: boolean
}

export type PolicyInfo = {
  id: string
  name: string
  description?: string
  enabled: boolean
  rules: Array<PolicyRule>
  source: PolicySource
  managed: boolean
  suppressed: boolean
}

export type IntegrationKeyMethod = {
  type: "key"
  label?: string | undefined
  form?: IntegrationMethodFormFields | undefined
}

export type IntegrationOAuthClientConfiguration = { fields: FormFields; configured: boolean }

export type SessionEventPayload =
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.created"
      created: number
      data: { sessionID: string & Brand.Brand<"Session.ID">; session: SessionInfo }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.updated"
      created: number
      data: { sessionID: string & Brand.Brand<"Session.ID">; session: SessionInfo }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.deleted"
      created: number
      data: { sessionID: string & Brand.Brand<"Session.ID"> }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.input.admitted"
      created: number
      data: { sessionID: string & Brand.Brand<"Session.ID">; item: SessionInboxInfo }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.input.promoted"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        inboxID: string & Brand.Brand<"Message.ID">
        message: {
          id: string & Brand.Brand<"Message.ID">
          sessionID: string & Brand.Brand<"Session.ID">
          sequence: number
          createdAt: string
          type: "user"
          text: string
          agents?: Array<PromptAgentAttachment>
          metadata?: { [x: string]: any }
          delivery?: SessionInboxDelivery
          admittedSequence: number
        }
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.synthetic.admitted"
      created: number
      data: { sessionID: string & Brand.Brand<"Session.ID">; item: SessionInboxInfo }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.synthetic.promoted"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        inboxID: string & Brand.Brand<"Message.ID">
        message: {
          id: string & Brand.Brand<"Message.ID">
          sessionID: string & Brand.Brand<"Session.ID">
          sequence: number
          createdAt: string
          type: "synthetic"
          text: string
          description?: string
          metadata?: { [x: string]: JsonValue }
        }
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.run.started"
      created: number
      data: { sessionID: string & Brand.Brand<"Session.ID"> }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.run.succeeded"
      created: number
      data: { sessionID: string & Brand.Brand<"Session.ID"> }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.run.failed"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        error:
          | { _tag: "SessionError.AbortedError"; message: string }
          | {
              _tag: "SessionError.ProviderError"
              message: string
              category?:
                | "auth"
                | "rate-limit"
                | "quota"
                | "content-filter"
                | "transport"
                | "internal"
                | "invalid-request"
                | "context-overflow"
                | "unknown"
              status?: number
              provider?: string
              model?: string
              requestID?: string
              responseBody?: string
              bodyTruncated?: boolean
            }
          | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
          | { _tag: "SessionError.InternalError"; message: string }
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.run.interrupted"
      created: number
      data: { sessionID: string & Brand.Brand<"Session.ID">; reason: "user" | "shutdown" | "superseded" }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.execution.started"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        message: {
          id: string & Brand.Brand<"Message.ID">
          sessionID: string & Brand.Brand<"Session.ID">
          sequence: number
          createdAt: string
          type: "assistant"
          agent: string & Brand.Brand<"Agent.ID">
          model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
          requestedModel?: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
          route?: {
            cause: "none" | "rule" | "judge" | "pinned" | "fallback"
            rule?: number
            tier?: string
            fallback?: "timeout" | "invalid" | "unavailable" | "error" | "unpinned"
          }
          content: Array<
            | {
                type: "text"
                id: string
                text: string
                providerExecuted?: boolean
                providerMetadata?: { [x: string]: JsonValue }
              }
            | {
                type: "reasoning"
                id: string
                text: string
                providerExecuted?: boolean
                providerMetadata?: { [x: string]: JsonValue }
                time?: { created: string; completed?: string }
              }
            | {
                type: "tool"
                id: string
                name: string
                state:
                  | { status: "streaming"; input: string }
                  | { status: "running"; input: { [x: string]: JsonValue }; metadata?: { [x: string]: JsonValue } }
                  | {
                      status: "completed"
                      input: { [x: string]: JsonValue }
                      content: Array<
                        | { type: "text"; text: string }
                        | { type: "file"; uri: string; mime: string; name?: string | undefined }
                      >
                      result?: JsonValue
                      metadata?: { [x: string]: JsonValue }
                    }
                  | {
                      status: "error"
                      input: { [x: string]: JsonValue }
                      error:
                        | { _tag: "SessionError.AbortedError"; message: string }
                        | {
                            _tag: "SessionError.ProviderError"
                            message: string
                            category?:
                              | "auth"
                              | "rate-limit"
                              | "quota"
                              | "content-filter"
                              | "transport"
                              | "internal"
                              | "invalid-request"
                              | "context-overflow"
                              | "unknown"
                            status?: number
                            provider?: string
                            model?: string
                            requestID?: string
                            responseBody?: string
                            bodyTruncated?: boolean
                          }
                        | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
                        | { _tag: "SessionError.InternalError"; message: string }
                      metadata?: { [x: string]: JsonValue }
                    }
                providerExecuted?: boolean
                providerMetadata?: { [x: string]: JsonValue }
                time: { created: string; ran?: string; completed?: string }
              }
          >
          finish?: "length" | "stop" | "tool-calls" | "content-filter" | "error" | "unknown"
          error?:
            | { _tag: "SessionError.AbortedError"; message: string }
            | {
                _tag: "SessionError.ProviderError"
                message: string
                category?:
                  | "auth"
                  | "rate-limit"
                  | "quota"
                  | "content-filter"
                  | "transport"
                  | "internal"
                  | "invalid-request"
                  | "context-overflow"
                  | "unknown"
                status?: number
                provider?: string
                model?: string
                requestID?: string
                responseBody?: string
                bodyTruncated?: boolean
              }
            | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
            | { _tag: "SessionError.InternalError"; message: string }
          time: { created: string; streamed?: string; completed?: string }
          retry?: {
            attempt: number
            at: string
            error:
              | { _tag: "SessionError.AbortedError"; message: string }
              | {
                  _tag: "SessionError.ProviderError"
                  message: string
                  category?:
                    | "auth"
                    | "rate-limit"
                    | "quota"
                    | "content-filter"
                    | "transport"
                    | "internal"
                    | "invalid-request"
                    | "context-overflow"
                    | "unknown"
                  status?: number
                  provider?: string
                  model?: string
                  requestID?: string
                  responseBody?: string
                  bodyTruncated?: boolean
                }
              | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
              | { _tag: "SessionError.InternalError"; message: string }
          }
          usage: {
            cost: number
            costComplete?: boolean
            tokens: {
              total?: number
              input: number
              output: number
              reasoning: number
              cache: { read: number; write: number }
            }
          }
        }
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.execution.model.routed"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        messageID: string & Brand.Brand<"Message.ID">
        requestedModel: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
        model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
        route?: {
          cause: "none" | "rule" | "judge" | "pinned" | "fallback"
          rule?: number
          tier?: string
          fallback?: "timeout" | "invalid" | "unavailable" | "error" | "unpinned"
        }
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.execution.streamed"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        messageID: string & Brand.Brand<"Message.ID">
        attempt: number
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.retry.scheduled"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        messageID: string & Brand.Brand<"Message.ID">
        attempt: number
        at: string
        error:
          | { _tag: "SessionError.AbortedError"; message: string }
          | {
              _tag: "SessionError.ProviderError"
              message: string
              category?:
                | "auth"
                | "rate-limit"
                | "quota"
                | "content-filter"
                | "transport"
                | "internal"
                | "invalid-request"
                | "context-overflow"
                | "unknown"
              status?: number
              provider?: string
              model?: string
              requestID?: string
              responseBody?: string
              bodyTruncated?: boolean
            }
          | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
          | { _tag: "SessionError.InternalError"; message: string }
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.execution.succeeded"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        message: {
          id: string & Brand.Brand<"Message.ID">
          sessionID: string & Brand.Brand<"Session.ID">
          sequence: number
          createdAt: string
          type: "assistant"
          agent: string & Brand.Brand<"Agent.ID">
          model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
          requestedModel?: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
          route?: {
            cause: "none" | "rule" | "judge" | "pinned" | "fallback"
            rule?: number
            tier?: string
            fallback?: "timeout" | "invalid" | "unavailable" | "error" | "unpinned"
          }
          content: Array<
            | {
                type: "text"
                id: string
                text: string
                providerExecuted?: boolean
                providerMetadata?: { [x: string]: JsonValue }
              }
            | {
                type: "reasoning"
                id: string
                text: string
                providerExecuted?: boolean
                providerMetadata?: { [x: string]: JsonValue }
                time?: { created: string; completed?: string }
              }
            | {
                type: "tool"
                id: string
                name: string
                state:
                  | { status: "streaming"; input: string }
                  | { status: "running"; input: { [x: string]: JsonValue }; metadata?: { [x: string]: JsonValue } }
                  | {
                      status: "completed"
                      input: { [x: string]: JsonValue }
                      content: Array<
                        | { type: "text"; text: string }
                        | { type: "file"; uri: string; mime: string; name?: string | undefined }
                      >
                      result?: JsonValue
                      metadata?: { [x: string]: JsonValue }
                    }
                  | {
                      status: "error"
                      input: { [x: string]: JsonValue }
                      error:
                        | { _tag: "SessionError.AbortedError"; message: string }
                        | {
                            _tag: "SessionError.ProviderError"
                            message: string
                            category?:
                              | "auth"
                              | "rate-limit"
                              | "quota"
                              | "content-filter"
                              | "transport"
                              | "internal"
                              | "invalid-request"
                              | "context-overflow"
                              | "unknown"
                            status?: number
                            provider?: string
                            model?: string
                            requestID?: string
                            responseBody?: string
                            bodyTruncated?: boolean
                          }
                        | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
                        | { _tag: "SessionError.InternalError"; message: string }
                      metadata?: { [x: string]: JsonValue }
                    }
                providerExecuted?: boolean
                providerMetadata?: { [x: string]: JsonValue }
                time: { created: string; ran?: string; completed?: string }
              }
          >
          finish?: "length" | "stop" | "tool-calls" | "content-filter" | "error" | "unknown"
          error?:
            | { _tag: "SessionError.AbortedError"; message: string }
            | {
                _tag: "SessionError.ProviderError"
                message: string
                category?:
                  | "auth"
                  | "rate-limit"
                  | "quota"
                  | "content-filter"
                  | "transport"
                  | "internal"
                  | "invalid-request"
                  | "context-overflow"
                  | "unknown"
                status?: number
                provider?: string
                model?: string
                requestID?: string
                responseBody?: string
                bodyTruncated?: boolean
              }
            | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
            | { _tag: "SessionError.InternalError"; message: string }
          time: { created: string; streamed?: string; completed?: string }
          retry?: {
            attempt: number
            at: string
            error:
              | { _tag: "SessionError.AbortedError"; message: string }
              | {
                  _tag: "SessionError.ProviderError"
                  message: string
                  category?:
                    | "auth"
                    | "rate-limit"
                    | "quota"
                    | "content-filter"
                    | "transport"
                    | "internal"
                    | "invalid-request"
                    | "context-overflow"
                    | "unknown"
                  status?: number
                  provider?: string
                  model?: string
                  requestID?: string
                  responseBody?: string
                  bodyTruncated?: boolean
                }
              | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
              | { _tag: "SessionError.InternalError"; message: string }
          }
          usage: {
            cost: number
            costComplete?: boolean
            tokens: {
              total?: number
              input: number
              output: number
              reasoning: number
              cache: { read: number; write: number }
            }
          }
        }
        finish: "length" | "stop" | "tool-calls" | "content-filter" | "error" | "unknown"
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.execution.failed"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        message: {
          id: string & Brand.Brand<"Message.ID">
          sessionID: string & Brand.Brand<"Session.ID">
          sequence: number
          createdAt: string
          type: "assistant"
          agent: string & Brand.Brand<"Agent.ID">
          model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
          requestedModel?: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
          route?: {
            cause: "none" | "rule" | "judge" | "pinned" | "fallback"
            rule?: number
            tier?: string
            fallback?: "timeout" | "invalid" | "unavailable" | "error" | "unpinned"
          }
          content: Array<
            | {
                type: "text"
                id: string
                text: string
                providerExecuted?: boolean
                providerMetadata?: { [x: string]: JsonValue }
              }
            | {
                type: "reasoning"
                id: string
                text: string
                providerExecuted?: boolean
                providerMetadata?: { [x: string]: JsonValue }
                time?: { created: string; completed?: string }
              }
            | {
                type: "tool"
                id: string
                name: string
                state:
                  | { status: "streaming"; input: string }
                  | { status: "running"; input: { [x: string]: JsonValue }; metadata?: { [x: string]: JsonValue } }
                  | {
                      status: "completed"
                      input: { [x: string]: JsonValue }
                      content: Array<
                        | { type: "text"; text: string }
                        | { type: "file"; uri: string; mime: string; name?: string | undefined }
                      >
                      result?: JsonValue
                      metadata?: { [x: string]: JsonValue }
                    }
                  | {
                      status: "error"
                      input: { [x: string]: JsonValue }
                      error:
                        | { _tag: "SessionError.AbortedError"; message: string }
                        | {
                            _tag: "SessionError.ProviderError"
                            message: string
                            category?:
                              | "auth"
                              | "rate-limit"
                              | "quota"
                              | "content-filter"
                              | "transport"
                              | "internal"
                              | "invalid-request"
                              | "context-overflow"
                              | "unknown"
                            status?: number
                            provider?: string
                            model?: string
                            requestID?: string
                            responseBody?: string
                            bodyTruncated?: boolean
                          }
                        | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
                        | { _tag: "SessionError.InternalError"; message: string }
                      metadata?: { [x: string]: JsonValue }
                    }
                providerExecuted?: boolean
                providerMetadata?: { [x: string]: JsonValue }
                time: { created: string; ran?: string; completed?: string }
              }
          >
          finish?: "length" | "stop" | "tool-calls" | "content-filter" | "error" | "unknown"
          error?:
            | { _tag: "SessionError.AbortedError"; message: string }
            | {
                _tag: "SessionError.ProviderError"
                message: string
                category?:
                  | "auth"
                  | "rate-limit"
                  | "quota"
                  | "content-filter"
                  | "transport"
                  | "internal"
                  | "invalid-request"
                  | "context-overflow"
                  | "unknown"
                status?: number
                provider?: string
                model?: string
                requestID?: string
                responseBody?: string
                bodyTruncated?: boolean
              }
            | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
            | { _tag: "SessionError.InternalError"; message: string }
          time: { created: string; streamed?: string; completed?: string }
          retry?: {
            attempt: number
            at: string
            error:
              | { _tag: "SessionError.AbortedError"; message: string }
              | {
                  _tag: "SessionError.ProviderError"
                  message: string
                  category?:
                    | "auth"
                    | "rate-limit"
                    | "quota"
                    | "content-filter"
                    | "transport"
                    | "internal"
                    | "invalid-request"
                    | "context-overflow"
                    | "unknown"
                  status?: number
                  provider?: string
                  model?: string
                  requestID?: string
                  responseBody?: string
                  bodyTruncated?: boolean
                }
              | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
              | { _tag: "SessionError.InternalError"; message: string }
          }
          usage: {
            cost: number
            costComplete?: boolean
            tokens: {
              total?: number
              input: number
              output: number
              reasoning: number
              cache: { read: number; write: number }
            }
          }
        }
        error:
          | { _tag: "SessionError.AbortedError"; message: string }
          | {
              _tag: "SessionError.ProviderError"
              message: string
              category?:
                | "auth"
                | "rate-limit"
                | "quota"
                | "content-filter"
                | "transport"
                | "internal"
                | "invalid-request"
                | "context-overflow"
                | "unknown"
              status?: number
              provider?: string
              model?: string
              requestID?: string
              responseBody?: string
              bodyTruncated?: boolean
            }
          | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
          | { _tag: "SessionError.InternalError"; message: string }
        finish?: "length" | "stop" | "tool-calls" | "content-filter" | "error" | "unknown"
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.execution.interrupted"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        message: {
          id: string & Brand.Brand<"Message.ID">
          sessionID: string & Brand.Brand<"Session.ID">
          sequence: number
          createdAt: string
          type: "assistant"
          agent: string & Brand.Brand<"Agent.ID">
          model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
          requestedModel?: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
          route?: {
            cause: "none" | "rule" | "judge" | "pinned" | "fallback"
            rule?: number
            tier?: string
            fallback?: "timeout" | "invalid" | "unavailable" | "error" | "unpinned"
          }
          content: Array<
            | {
                type: "text"
                id: string
                text: string
                providerExecuted?: boolean
                providerMetadata?: { [x: string]: JsonValue }
              }
            | {
                type: "reasoning"
                id: string
                text: string
                providerExecuted?: boolean
                providerMetadata?: { [x: string]: JsonValue }
                time?: { created: string; completed?: string }
              }
            | {
                type: "tool"
                id: string
                name: string
                state:
                  | { status: "streaming"; input: string }
                  | { status: "running"; input: { [x: string]: JsonValue }; metadata?: { [x: string]: JsonValue } }
                  | {
                      status: "completed"
                      input: { [x: string]: JsonValue }
                      content: Array<
                        | { type: "text"; text: string }
                        | { type: "file"; uri: string; mime: string; name?: string | undefined }
                      >
                      result?: JsonValue
                      metadata?: { [x: string]: JsonValue }
                    }
                  | {
                      status: "error"
                      input: { [x: string]: JsonValue }
                      error:
                        | { _tag: "SessionError.AbortedError"; message: string }
                        | {
                            _tag: "SessionError.ProviderError"
                            message: string
                            category?:
                              | "auth"
                              | "rate-limit"
                              | "quota"
                              | "content-filter"
                              | "transport"
                              | "internal"
                              | "invalid-request"
                              | "context-overflow"
                              | "unknown"
                            status?: number
                            provider?: string
                            model?: string
                            requestID?: string
                            responseBody?: string
                            bodyTruncated?: boolean
                          }
                        | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
                        | { _tag: "SessionError.InternalError"; message: string }
                      metadata?: { [x: string]: JsonValue }
                    }
                providerExecuted?: boolean
                providerMetadata?: { [x: string]: JsonValue }
                time: { created: string; ran?: string; completed?: string }
              }
          >
          finish?: "length" | "stop" | "tool-calls" | "content-filter" | "error" | "unknown"
          error?:
            | { _tag: "SessionError.AbortedError"; message: string }
            | {
                _tag: "SessionError.ProviderError"
                message: string
                category?:
                  | "auth"
                  | "rate-limit"
                  | "quota"
                  | "content-filter"
                  | "transport"
                  | "internal"
                  | "invalid-request"
                  | "context-overflow"
                  | "unknown"
                status?: number
                provider?: string
                model?: string
                requestID?: string
                responseBody?: string
                bodyTruncated?: boolean
              }
            | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
            | { _tag: "SessionError.InternalError"; message: string }
          time: { created: string; streamed?: string; completed?: string }
          retry?: {
            attempt: number
            at: string
            error:
              | { _tag: "SessionError.AbortedError"; message: string }
              | {
                  _tag: "SessionError.ProviderError"
                  message: string
                  category?:
                    | "auth"
                    | "rate-limit"
                    | "quota"
                    | "content-filter"
                    | "transport"
                    | "internal"
                    | "invalid-request"
                    | "context-overflow"
                    | "unknown"
                  status?: number
                  provider?: string
                  model?: string
                  requestID?: string
                  responseBody?: string
                  bodyTruncated?: boolean
                }
              | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
              | { _tag: "SessionError.InternalError"; message: string }
          }
          usage: {
            cost: number
            costComplete?: boolean
            tokens: {
              total?: number
              input: number
              output: number
              reasoning: number
              cache: { read: number; write: number }
            }
          }
        }
        error: { _tag: "SessionError.AbortedError"; message: string }
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.step.started"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        messageID: string & Brand.Brand<"Message.ID">
        index: number
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.step.ended"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        messageID: string & Brand.Brand<"Message.ID">
        index: number
        finish: string
        usage: {
          cost: number
          costComplete?: boolean
          tokens: {
            total?: number
            input: number
            output: number
            reasoning: number
            cache: { read: number; write: number }
          }
        }
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.step.failed"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        messageID: string & Brand.Brand<"Message.ID">
        index: number
        error:
          | { _tag: "SessionError.AbortedError"; message: string }
          | {
              _tag: "SessionError.ProviderError"
              message: string
              category?:
                | "auth"
                | "rate-limit"
                | "quota"
                | "content-filter"
                | "transport"
                | "internal"
                | "invalid-request"
                | "context-overflow"
                | "unknown"
              status?: number
              provider?: string
              model?: string
              requestID?: string
              responseBody?: string
              bodyTruncated?: boolean
            }
          | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
          | { _tag: "SessionError.InternalError"; message: string }
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.text.started"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        messageID: string & Brand.Brand<"Message.ID">
        partID: string
        ordinal: number
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.text.ended"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        messageID: string & Brand.Brand<"Message.ID">
        partID: string
        text: string
        providerMetadata?: { [x: string]: JsonValue }
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.reasoning.started"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        messageID: string & Brand.Brand<"Message.ID">
        partID: string
        ordinal: number
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.reasoning.ended"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        messageID: string & Brand.Brand<"Message.ID">
        partID: string
        text: string
        providerMetadata?: { [x: string]: JsonValue }
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.tool.input.started"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        messageID: string & Brand.Brand<"Message.ID">
        callID: string
        ordinal: number
        name: string
        providerExecuted?: boolean
        providerMetadata?: { [x: string]: JsonValue }
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.tool.input.ended"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        messageID: string & Brand.Brand<"Message.ID">
        callID: string
        name: string
        input: string
        providerMetadata?: { [x: string]: JsonValue }
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.tool.called"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        messageID: string & Brand.Brand<"Message.ID">
        callID: string
        name: string
        input: { [x: string]: JsonValue }
        providerExecuted?: boolean
        providerMetadata?: { [x: string]: JsonValue }
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.tool.success"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        messageID: string & Brand.Brand<"Message.ID">
        callID: string
        name: string
        input: { [x: string]: JsonValue }
        content: Array<
          { type: "text"; text: string } | { type: "file"; uri: string; mime: string; name?: string | undefined }
        >
        result?: JsonValue
        metadata?: { [x: string]: JsonValue }
        providerExecuted?: boolean
        providerMetadata?: { [x: string]: JsonValue }
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.tool.failed"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        messageID: string & Brand.Brand<"Message.ID">
        callID: string
        name: string
        input: { [x: string]: JsonValue }
        error:
          | { _tag: "SessionError.AbortedError"; message: string }
          | {
              _tag: "SessionError.ProviderError"
              message: string
              category?:
                | "auth"
                | "rate-limit"
                | "quota"
                | "content-filter"
                | "transport"
                | "internal"
                | "invalid-request"
                | "context-overflow"
                | "unknown"
              status?: number
              provider?: string
              model?: string
              requestID?: string
              responseBody?: string
              bodyTruncated?: boolean
            }
          | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
          | { _tag: "SessionError.InternalError"; message: string }
        metadata?: { [x: string]: JsonValue }
        providerExecuted?: boolean
        providerMetadata?: { [x: string]: JsonValue }
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.next.agent.switched"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        message: {
          id: string & Brand.Brand<"Message.ID">
          sessionID: string & Brand.Brand<"Session.ID">
          sequence: number
          createdAt: string
          type: "agent-switched"
          agent: string & Brand.Brand<"Agent.ID">
        }
        agent: string & Brand.Brand<"Agent.ID">
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.next.model.switched"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        message: {
          id: string & Brand.Brand<"Message.ID">
          sessionID: string & Brand.Brand<"Session.ID">
          sequence: number
          createdAt: string
          type: "model-switched"
          model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
        }
        model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.instruction.updated"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        delta: { [x: string]: (string & Brand.Brand<"Instruction.Hash">) | "removed" }
        system?: {
          id: string & Brand.Brand<"Message.ID">
          sessionID: string & Brand.Brand<"Session.ID">
          sequence: number
          createdAt: string
          type: "system"
          text: string
          description?: string
        }
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.compaction.requested"
      created: number
      data: { sessionID: string & Brand.Brand<"Session.ID">; messageID: string & Brand.Brand<"Message.ID"> }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.compaction.started"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        message: {
          id: string & Brand.Brand<"Message.ID">
          sessionID: string & Brand.Brand<"Session.ID">
          sequence: number
          createdAt: string
          type: "compaction"
          reason: "manual" | "auto"
          status: "running"
          summary: string
          recent: string
        }
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.compaction.ended"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        message: {
          id: string & Brand.Brand<"Message.ID">
          sessionID: string & Brand.Brand<"Session.ID">
          sequence: number
          createdAt: string
          type: "compaction"
          reason: "manual" | "auto"
          status: "completed"
          summary: string
          recent: string
        }
        usage: {
          cost: number
          costComplete?: boolean
          tokens: {
            total?: number
            input: number
            output: number
            reasoning: number
            cache: { read: number; write: number }
          }
        }
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.compaction.failed"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        message: {
          id: string & Brand.Brand<"Message.ID">
          sessionID: string & Brand.Brand<"Session.ID">
          sequence: number
          createdAt: string
          type: "compaction"
          reason: "manual" | "auto"
          status: "failed"
          error:
            | { _tag: "SessionError.AbortedError"; message: string }
            | {
                _tag: "SessionError.ProviderError"
                message: string
                category?:
                  | "auth"
                  | "rate-limit"
                  | "quota"
                  | "content-filter"
                  | "transport"
                  | "internal"
                  | "invalid-request"
                  | "context-overflow"
                  | "unknown"
                status?: number
                provider?: string
                model?: string
                requestID?: string
                responseBody?: string
                bodyTruncated?: boolean
              }
            | { _tag: "SessionError.ToolError"; message: string; metadata?: { [x: string]: JsonValue } }
            | { _tag: "SessionError.InternalError"; message: string }
        }
        usage: {
          cost: number
          costComplete?: boolean
          tokens: {
            total?: number
            input: number
            output: number
            reasoning: number
            cache: { read: number; write: number }
          }
        }
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.text.delta"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        messageID: string & Brand.Brand<"Message.ID">
        partID: string
        text: string
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.reasoning.delta"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        messageID: string & Brand.Brand<"Message.ID">
        partID: string
        text: string
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.tool.input.delta"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        messageID: string & Brand.Brand<"Message.ID">
        callID: string
        text: string
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.tool.progress"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        messageID: string & Brand.Brand<"Message.ID">
        callID: string
        metadata: { [x: string]: JsonValue }
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.policy.enforced"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        messageID?: string & Brand.Brand<"Message.ID">
        callID?: string
        policy: string
        rule: number
        action: string
        resource: string
        effect: "route" | "deny" | "transform"
        message?: string
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "permission.v2.asked"
      created: number
      data: {
        id: string & Brand.Brand<"Permission.ID">
        sessionID: string & Brand.Brand<"Session.ID">
        action: string
        resources: Array<string>
        save?: Array<string>
        metadata?: { [x: string]: any }
        source?: { type: "tool"; messageID: string & Brand.Brand<"Message.ID">; callID: string }
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "permission.v2.replied"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        requestID: string & Brand.Brand<"Permission.ID">
        reply: "once" | "always" | "reject"
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "form.created"
      created: number
      data: {
        id: string & Brand.Brand<"Form.ID">
        sessionID: string & Brand.Brand<"Session.ID">
        title: string
        metadata?: FormMetadata
        fields: FormFields
      }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "form.replied"
      created: number
      data: { id: string & Brand.Brand<"Form.ID">; sessionID: string & Brand.Brand<"Session.ID">; answer: FormAnswer }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "form.cancelled"
      created: number
      data: { id: string & Brand.Brand<"Form.ID">; sessionID: string & Brand.Brand<"Session.ID"> }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "session.compaction.delta"
      created: number
      data: {
        sessionID: string & Brand.Brand<"Session.ID">
        messageID: string & Brand.Brand<"Message.ID">
        text: string
      }
    }

export type FormInfo = {
  id: string & Brand.Brand<"Form.ID">
  sessionID?: (string & Brand.Brand<"Session.ID">) | undefined
  title: string
  metadata?: FormMetadata | undefined
  fields: FormFields
}

export type IntegrationOAuthMethod = {
  id: string & Brand.Brand<"Integration.MethodID">
  type: "oauth"
  label: string
  form?: IntegrationMethodFormFields | undefined
  client?: IntegrationOAuthClientConfiguration | undefined
}

export type WorkspaceEventItem =
  | { id: string & Brand.Brand<"Event.ID">; type: "server.connected"; data: {} }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "agent.created"
      created: number
      data: { workspaceID: string & Brand.Brand<"Workspace.ID">; id: string & Brand.Brand<"Agent.ID"> }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "agent.updated"
      created: number
      data: { workspaceID: string & Brand.Brand<"Workspace.ID">; id: string & Brand.Brand<"Agent.ID"> }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "agent.deleted"
      created: number
      data: { workspaceID: string & Brand.Brand<"Workspace.ID">; id: string & Brand.Brand<"Agent.ID"> }
    }
  | { id: string & Brand.Brand<"Event.ID">; type: "config.updated"; created: number; data: {} }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "plugin.added"
      created: number
      data: { id: string & Brand.Brand<"Plugin.ID"> }
    }
  | { id: string & Brand.Brand<"Event.ID">; type: "plugin.updated"; created: number; data: {} }
  | { id: string & Brand.Brand<"Event.ID">; type: "integration.updated"; created: number; data: {} }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "integration.connection.updated"
      created: number
      data: { integrationID: string & Brand.Brand<"Integration.ID"> }
    }
  | { id: string & Brand.Brand<"Event.ID">; type: "websearch.updated"; created: number; data: {} }
  | { id: string & Brand.Brand<"Event.ID">; type: "mcp.status.changed"; created: number; data: {} }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "project.file.changed"
      created: number
      data: { projectID: string & Brand.Brand<"Project.ID">; path: string & Brand.Brand<"ProjectDirectory.Path"> }
    }
  | SessionEventPayload
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "scheduledTask.updated"
      created: number
      data: { task: ScheduledTaskInfo }
    }
  | {
      id: string & Brand.Brand<"Event.ID">
      type: "scheduledTask.deleted"
      created: number
      data: { taskID: string & Brand.Brand<"ScheduledTask.ID"> }
    }

export type IntegrationMethodInfo =
  | IntegrationOAuthMethod
  | IntegrationCommandMethod
  | IntegrationKeyMethod
  | IntegrationEnvMethod
  | {
      id: string & Brand.Brand<"Integration.MethodID">
      type: "aws-sigv4"
      label: string
      region: {
        key: string
        title?: string | undefined
        description?: string | undefined
        required?: boolean | undefined
        when?: Array<FormWhen> | undefined
        type: "string"
        secret?: boolean | undefined
        multiline?: boolean | undefined
        format?: "email" | "uri" | "date" | "date-time" | undefined
        minLength?: number | undefined
        maxLength?: number | undefined
        pattern?: string | undefined
        placeholder?: string | undefined
        default?: string | undefined
        options?: Array<FormOption> | undefined
        custom?: boolean | undefined
      }
    }
  | IntegrationEnvGroupMethodInfo
  | IntegrationValuesMethodInfo

export type IntegrationInfo = {
  id: string & Brand.Brand<"Integration.ID">
  name: string
  connectionPolicy?: IntegrationConnectionPolicy
  methods: Array<IntegrationMethodInfo>
  connections: Array<ConnectionInfo>
}

export type ProviderDirectoryEntry = {
  info: ProviderInfo
  integration?: IntegrationInfo
  active: boolean
  connected: boolean
  connectionCount: number
  modelCount: number
}

export type InvalidRequestError = { readonly _tag: "InvalidRequestError"; readonly message: string }
export const isInvalidRequestError = (value: unknown): value is InvalidRequestError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "InvalidRequestError"

export type ServiceUnavailableError = { readonly _tag: "ServiceUnavailableError"; readonly message: string }
export const isServiceUnavailableError = (value: unknown): value is ServiceUnavailableError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ServiceUnavailableError"

export type ForbiddenError = { readonly _tag: "ForbiddenError"; readonly message: string }
export const isForbiddenError = (value: unknown): value is ForbiddenError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ForbiddenError"

export type ProtocolInputError = { readonly _tag: "Protocol.InputError"; readonly error: string }
export const isProtocolInputError = (value: unknown): value is ProtocolInputError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "Protocol.InputError"

export type ShareNotFoundError = {
  readonly _tag: "Share.NotFoundError"
  readonly workspaceID: string & Brand.Brand<"Workspace.ID">
  readonly token: string & Brand.Brand<"Share.Token">
  readonly message: string
}
export const isShareNotFoundError = (value: unknown): value is ShareNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "Share.NotFoundError"

export type ProtocolInternalError = { readonly _tag: "Protocol.InternalError"; readonly error: string }
export const isProtocolInternalError = (value: unknown): value is ProtocolInternalError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "Protocol.InternalError"

export type UnauthorizedError = { readonly _tag: "UnauthorizedError"; readonly message: string }
export const isUnauthorizedError = (value: unknown): value is UnauthorizedError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "UnauthorizedError"

export type AuthNotFoundError = { readonly _tag: "Auth.NotFoundError"; readonly id: string; readonly message: string }
export const isAuthNotFoundError = (value: unknown): value is AuthNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "Auth.NotFoundError"

export type OAuthNotFoundError = { readonly _tag: "OAuth.NotFoundError"; readonly id: string; readonly message: string }
export const isOAuthNotFoundError = (value: unknown): value is OAuthNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "OAuth.NotFoundError"

export type OAuthRequestNotFoundError = {
  readonly _tag: "OAuth.RequestNotFoundError"
  readonly requestID: string
  readonly message: string
}
export const isOAuthRequestNotFoundError = (value: unknown): value is OAuthRequestNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "OAuth.RequestNotFoundError"

export type ProjectNotFoundError = {
  readonly _tag: "Project.NotFoundError"
  readonly projectID: string
  readonly message: string
}
export const isProjectNotFoundError = (value: unknown): value is ProjectNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "Project.NotFoundError"

export type ProjectDefaultError = {
  readonly _tag: "Project.DefaultError"
  readonly projectID: string
  readonly message: string
}
export const isProjectDefaultError = (value: unknown): value is ProjectDefaultError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "Project.DefaultError"

export type ProjectFileNotFoundError = {
  readonly _tag: "ProjectFile.NotFoundError"
  readonly path: string
  readonly message: string
}
export const isProjectFileNotFoundError = (value: unknown): value is ProjectFileNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ProjectFile.NotFoundError"

export type ProjectFileConflictError = {
  readonly _tag: "ProjectFile.ConflictError"
  readonly path: string
  readonly message: string
}
export const isProjectFileConflictError = (value: unknown): value is ProjectFileConflictError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ProjectFile.ConflictError"

export type ScheduledTaskScheduleError = { readonly _tag: "ScheduledTask.ScheduleError"; readonly message: string }
export const isScheduledTaskScheduleError = (value: unknown): value is ScheduledTaskScheduleError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ScheduledTask.ScheduleError"

export type ScheduledTaskLimitError = {
  readonly _tag: "ScheduledTask.LimitError"
  readonly limit: number
  readonly message: string
}
export const isScheduledTaskLimitError = (value: unknown): value is ScheduledTaskLimitError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ScheduledTask.LimitError"

export type ProjectArchivedError = {
  readonly _tag: "Project.ArchivedError"
  readonly projectID: string
  readonly message: string
}
export const isProjectArchivedError = (value: unknown): value is ProjectArchivedError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "Project.ArchivedError"

export type ScheduledTaskNotFoundError = {
  readonly _tag: "ScheduledTask.NotFoundError"
  readonly taskID: string
  readonly message: string
}
export const isScheduledTaskNotFoundError = (value: unknown): value is ScheduledTaskNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ScheduledTask.NotFoundError"

export type ScheduledTaskRunError = {
  readonly _tag: "ScheduledTask.RunError"
  readonly taskID: string
  readonly message: string
}
export const isScheduledTaskRunError = (value: unknown): value is ScheduledTaskRunError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ScheduledTask.RunError"

export type SkillError = { readonly _tag: "Skill.Error"; readonly skillID: string; readonly message: string }
export const isSkillError = (value: unknown): value is SkillError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "Skill.Error"

export type PolicyNotFoundError = {
  readonly _tag: "Policy.NotFoundError"
  readonly id: string
  readonly message: string
}
export const isPolicyNotFoundError = (value: unknown): value is PolicyNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "Policy.NotFoundError"

export type SessionInvalidCursorError = { readonly _tag: "Session.InvalidCursorError"; readonly message: string }
export const isSessionInvalidCursorError = (value: unknown): value is SessionInvalidCursorError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "Session.InvalidCursorError"

export type IntegrationOAuthMethodNotFoundError = {
  readonly _tag: "Integration.OAuthMethodNotFoundError"
  readonly integrationID: string & Brand.Brand<"Integration.ID">
  readonly methodID: string & Brand.Brand<"Integration.MethodID">
  readonly message: string
}
export const isIntegrationOAuthMethodNotFoundError = (value: unknown): value is IntegrationOAuthMethodNotFoundError =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  value["_tag"] === "Integration.OAuthMethodNotFoundError"

export type MCPServerNotFoundError = {
  readonly _tag: "MCP.ServerNotFoundError"
  readonly server: string
  readonly message: string
}
export const isMCPServerNotFoundError = (value: unknown): value is MCPServerNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "MCP.ServerNotFoundError"

export type SessionNotFoundError = {
  readonly _tag: "Session.NotFoundError"
  readonly sessionID: string
  readonly message: string
}
export const isSessionNotFoundError = (value: unknown): value is SessionNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "Session.NotFoundError"

export type SessionPromptConflictError = {
  readonly _tag: "Session.PromptConflictError"
  readonly sessionID: string
  readonly messageID: string
  readonly message: string
}
export const isSessionPromptConflictError = (value: unknown): value is SessionPromptConflictError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "Session.PromptConflictError"

export type SessionCompactionConflictError = {
  readonly _tag: "Session.CompactionConflictError"
  readonly sessionID: string
  readonly messageID: string
  readonly message: string
}
export const isSessionCompactionConflictError = (value: unknown): value is SessionCompactionConflictError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "Session.CompactionConflictError"

export type SessionSyntheticConflictError = {
  readonly _tag: "Session.SyntheticConflictError"
  readonly sessionID: string
  readonly messageID: string
  readonly message: string
}
export const isSessionSyntheticConflictError = (value: unknown): value is SessionSyntheticConflictError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "Session.SyntheticConflictError"

export type InstructionEntrySizeError = {
  readonly _tag: "InstructionEntry.SizeError"
  readonly actualBytes: number
  readonly maxBytes: number
  readonly message: string
}
export const isInstructionEntrySizeError = (value: unknown): value is InstructionEntrySizeError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "InstructionEntry.SizeError"

export type AgentNotFoundError = {
  readonly _tag: "Agent.NotFoundError"
  readonly id: string & Brand.Brand<"Agent.ID">
  readonly message: string
}
export const isAgentNotFoundError = (value: unknown): value is AgentNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "Agent.NotFoundError"

export type AgentModelUnavailableError = {
  readonly _tag: "Agent.ModelUnavailableError"
  readonly model: {
    readonly id: string
    readonly provider: string & Brand.Brand<"Provider.Name">
    readonly variant?: string
  }
  readonly message: string
}
export const isAgentModelUnavailableError = (value: unknown): value is AgentModelUnavailableError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "Agent.ModelUnavailableError"

export type AgentConflictError = {
  readonly _tag: "Agent.ConflictError"
  readonly id: string & Brand.Brand<"Agent.ID">
  readonly message: string
}
export const isAgentConflictError = (value: unknown): value is AgentConflictError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "Agent.ConflictError"

export type ServiceAccountNotFoundError = {
  readonly _tag: "ServiceAccount.NotFoundError"
  readonly id: string
  readonly message: string
}
export const isServiceAccountNotFoundError = (value: unknown): value is ServiceAccountNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ServiceAccount.NotFoundError"

export type PermissionNotFoundError = {
  readonly _tag: "Permission.NotFoundError"
  readonly requestID: string
  readonly message: string
}
export const isPermissionNotFoundError = (value: unknown): value is PermissionNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "Permission.NotFoundError"

export type FormNotFoundError = { readonly _tag: "Form.NotFoundError"; readonly id: string; readonly message: string }
export const isFormNotFoundError = (value: unknown): value is FormNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "Form.NotFoundError"

export type FormAlreadySettledError = {
  readonly _tag: "Form.AlreadySettledError"
  readonly id: string
  readonly message: string
}
export const isFormAlreadySettledError = (value: unknown): value is FormAlreadySettledError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "Form.AlreadySettledError"

export type FormInvalidAnswerError = {
  readonly _tag: "Form.InvalidAnswerError"
  readonly id: string
  readonly message: string
}
export const isFormInvalidAnswerError = (value: unknown): value is FormInvalidAnswerError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "Form.InvalidAnswerError"

export type FormAlreadyExistsError = {
  readonly _tag: "Form.AlreadyExistsError"
  readonly id: string
  readonly message: string
}
export const isFormAlreadyExistsError = (value: unknown): value is FormAlreadyExistsError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "Form.AlreadyExistsError"

export type ServerSystemHealthOutput = string

export type AuthLoginInput = {
  readonly redirect?: { readonly redirect?: string; readonly provider?: string }["redirect"]
  readonly provider?: { readonly redirect?: string; readonly provider?: string }["provider"]
}

export type AuthLoginOutput = void

export type AuthCallbackInput = {
  readonly code: { readonly code: string; readonly state: string }["code"]
  readonly state: { readonly code: string; readonly state: string }["state"]
}

export type AuthCallbackOutput = void

export type AuthCallbackProviderInput = {
  readonly providerID: { readonly providerID: string }["providerID"]
  readonly code: { readonly code: string; readonly state: string }["code"]
  readonly state: { readonly code: string; readonly state: string }["state"]
}

export type AuthCallbackProviderOutput = void

export type AuthMethodOutput =
  | { state: "setup"; callbackBase: string; banner?: string; idleTimeout?: number }
  | {
      state: "ready"
      callbackBase: string
      providers: Array<{
        id: string & Brand.Brand<"AuthProvider.ID">
        displayName: string
        kind: "google" | "okta" | "microsoft" | "auth0" | "ping" | "custom"
      }>
      local?: boolean
      banner?: string
      idleTimeout?: number
    }

export type AuthInspectInput = { readonly token: { readonly token: string }["token"] }

export type AuthInspectOutput = Array<AuthProviderInfo>

export type AuthSetupInput = {
  readonly payload:
    | {
        readonly type: "create"
        readonly token: string
        readonly value: {
          readonly id: string & Brand.Brand<"AuthProvider.ID">
          readonly displayName: string
          readonly kind: "google" | "okta" | "microsoft" | "auth0" | "ping" | "custom"
          readonly domains: readonly [string, ...Array<string>]
          readonly issuer: string
          readonly clientID: string
          readonly clientSecret: string
        }
      }
    | {
        readonly type: "update"
        readonly token: string
        readonly value: {
          readonly id: string & Brand.Brand<"AuthProvider.ID">
          readonly revision: number & Brand.Brand<"AuthProvider.Revision">
          readonly displayName: string
          readonly kind: "google" | "okta" | "microsoft" | "auth0" | "ping" | "custom"
          readonly domains: readonly [string, ...Array<string>]
          readonly status: "enabled" | "disabled"
          readonly clientSecret?: string
        }
      }
}

export type AuthSetupOutput = AuthProviderInfo

export type AuthIntegrationCallbackInput = {
  readonly state?: {
    readonly state?: string
    readonly code?: string
    readonly error?: string
    readonly error_description?: string
  }["state"]
  readonly code?: {
    readonly state?: string
    readonly code?: string
    readonly error?: string
    readonly error_description?: string
  }["code"]
  readonly error?: {
    readonly state?: string
    readonly code?: string
    readonly error?: string
    readonly error_description?: string
  }["error"]
  readonly error_description?: {
    readonly state?: string
    readonly code?: string
    readonly error?: string
    readonly error_description?: string
  }["error_description"]
}

export type AuthIntegrationCallbackOutput = void

export type AuthIntegrationPageOutput = string

export type AuthLogoutInput = { readonly origin?: { readonly origin?: string }["origin"] }

export type AuthLogoutOutput = void

export type ServerShareGetInput = {
  readonly workspaceID: {
    readonly workspaceID: string & Brand.Brand<"Workspace.ID">
    readonly token: string & Brand.Brand<"Share.Token">
  }["workspaceID"]
  readonly token: {
    readonly workspaceID: string & Brand.Brand<"Workspace.ID">
    readonly token: string & Brand.Brand<"Share.Token">
  }["token"]
}

export type ServerShareGetOutput = ShareView

export type AccountGetOutput = {
  id: string & Brand.Brand<"Account.ID">
  email: (string & Brand.Brand<"Auth.Email">) | null
}

export type AccountSessionListOutput = Array<AccountSessionInfo>

export type AccountSessionRevokeInput = {
  readonly sessionID: { readonly sessionID: string & Brand.Brand<"Auth.SessionID"> }["sessionID"]
}

export type AccountSessionRevokeOutput = void

export type AccountGrantListOutput = Array<AccountGrantInfo>

export type AccountGrantRevokeInput = {
  readonly grantID: { readonly grantID: string & Brand.Brand<"OAuthGrant.ID"> }["grantID"]
}

export type AccountGrantRevokeOutput = void

export type AccountSuspendInput = {
  readonly accountID: { readonly accountID: string & Brand.Brand<"Account.ID"> }["accountID"]
}

export type AccountSuspendOutput = void

export type AccountRestoreInput = {
  readonly accountID: { readonly accountID: string & Brand.Brand<"Account.ID"> }["accountID"]
}

export type AccountRestoreOutput = void

export type WorkspaceListOutput = Array<WorkspaceAccessInfo>

export type ApiAuthProviderAuthProviderListOutput = Array<AuthProviderInfo>

export type ApiAuthProviderAuthProviderCreateInput = {
  readonly id: {
    readonly id: string & Brand.Brand<"AuthProvider.ID">
    readonly displayName: string
    readonly kind: "google" | "okta" | "microsoft" | "auth0" | "ping" | "custom"
    readonly domains: readonly [string, ...Array<string>]
    readonly issuer: string
    readonly clientID: string
    readonly clientSecret: string
  }["id"]
  readonly displayName: {
    readonly id: string & Brand.Brand<"AuthProvider.ID">
    readonly displayName: string
    readonly kind: "google" | "okta" | "microsoft" | "auth0" | "ping" | "custom"
    readonly domains: readonly [string, ...Array<string>]
    readonly issuer: string
    readonly clientID: string
    readonly clientSecret: string
  }["displayName"]
  readonly kind: {
    readonly id: string & Brand.Brand<"AuthProvider.ID">
    readonly displayName: string
    readonly kind: "google" | "okta" | "microsoft" | "auth0" | "ping" | "custom"
    readonly domains: readonly [string, ...Array<string>]
    readonly issuer: string
    readonly clientID: string
    readonly clientSecret: string
  }["kind"]
  readonly domains: {
    readonly id: string & Brand.Brand<"AuthProvider.ID">
    readonly displayName: string
    readonly kind: "google" | "okta" | "microsoft" | "auth0" | "ping" | "custom"
    readonly domains: readonly [string, ...Array<string>]
    readonly issuer: string
    readonly clientID: string
    readonly clientSecret: string
  }["domains"]
  readonly issuer: {
    readonly id: string & Brand.Brand<"AuthProvider.ID">
    readonly displayName: string
    readonly kind: "google" | "okta" | "microsoft" | "auth0" | "ping" | "custom"
    readonly domains: readonly [string, ...Array<string>]
    readonly issuer: string
    readonly clientID: string
    readonly clientSecret: string
  }["issuer"]
  readonly clientID: {
    readonly id: string & Brand.Brand<"AuthProvider.ID">
    readonly displayName: string
    readonly kind: "google" | "okta" | "microsoft" | "auth0" | "ping" | "custom"
    readonly domains: readonly [string, ...Array<string>]
    readonly issuer: string
    readonly clientID: string
    readonly clientSecret: string
  }["clientID"]
  readonly clientSecret: {
    readonly id: string & Brand.Brand<"AuthProvider.ID">
    readonly displayName: string
    readonly kind: "google" | "okta" | "microsoft" | "auth0" | "ping" | "custom"
    readonly domains: readonly [string, ...Array<string>]
    readonly issuer: string
    readonly clientID: string
    readonly clientSecret: string
  }["clientSecret"]
}

export type ApiAuthProviderAuthProviderCreateOutput = AuthProviderInfo

export type ApiAuthProviderAuthProviderGetInput = {
  readonly providerID: { readonly providerID: string & Brand.Brand<"AuthProvider.ID"> }["providerID"]
}

export type ApiAuthProviderAuthProviderGetOutput = AuthProviderInfo

export type ApiAuthProviderAuthProviderUpdateInput = {
  readonly providerID: { readonly providerID: string & Brand.Brand<"AuthProvider.ID"> }["providerID"]
  readonly id: {
    readonly id: string & Brand.Brand<"AuthProvider.ID">
    readonly revision: number & Brand.Brand<"AuthProvider.Revision">
    readonly displayName: string
    readonly kind: "google" | "okta" | "microsoft" | "auth0" | "ping" | "custom"
    readonly domains: readonly [string, ...Array<string>]
    readonly status: "enabled" | "disabled"
    readonly clientSecret?: string
  }["id"]
  readonly revision: {
    readonly id: string & Brand.Brand<"AuthProvider.ID">
    readonly revision: number & Brand.Brand<"AuthProvider.Revision">
    readonly displayName: string
    readonly kind: "google" | "okta" | "microsoft" | "auth0" | "ping" | "custom"
    readonly domains: readonly [string, ...Array<string>]
    readonly status: "enabled" | "disabled"
    readonly clientSecret?: string
  }["revision"]
  readonly displayName: {
    readonly id: string & Brand.Brand<"AuthProvider.ID">
    readonly revision: number & Brand.Brand<"AuthProvider.Revision">
    readonly displayName: string
    readonly kind: "google" | "okta" | "microsoft" | "auth0" | "ping" | "custom"
    readonly domains: readonly [string, ...Array<string>]
    readonly status: "enabled" | "disabled"
    readonly clientSecret?: string
  }["displayName"]
  readonly kind: {
    readonly id: string & Brand.Brand<"AuthProvider.ID">
    readonly revision: number & Brand.Brand<"AuthProvider.Revision">
    readonly displayName: string
    readonly kind: "google" | "okta" | "microsoft" | "auth0" | "ping" | "custom"
    readonly domains: readonly [string, ...Array<string>]
    readonly status: "enabled" | "disabled"
    readonly clientSecret?: string
  }["kind"]
  readonly domains: {
    readonly id: string & Brand.Brand<"AuthProvider.ID">
    readonly revision: number & Brand.Brand<"AuthProvider.Revision">
    readonly displayName: string
    readonly kind: "google" | "okta" | "microsoft" | "auth0" | "ping" | "custom"
    readonly domains: readonly [string, ...Array<string>]
    readonly status: "enabled" | "disabled"
    readonly clientSecret?: string
  }["domains"]
  readonly status: {
    readonly id: string & Brand.Brand<"AuthProvider.ID">
    readonly revision: number & Brand.Brand<"AuthProvider.Revision">
    readonly displayName: string
    readonly kind: "google" | "okta" | "microsoft" | "auth0" | "ping" | "custom"
    readonly domains: readonly [string, ...Array<string>]
    readonly status: "enabled" | "disabled"
    readonly clientSecret?: string
  }["status"]
  readonly clientSecret?: {
    readonly id: string & Brand.Brand<"AuthProvider.ID">
    readonly revision: number & Brand.Brand<"AuthProvider.Revision">
    readonly displayName: string
    readonly kind: "google" | "okta" | "microsoft" | "auth0" | "ping" | "custom"
    readonly domains: readonly [string, ...Array<string>]
    readonly status: "enabled" | "disabled"
    readonly clientSecret?: string
  }["clientSecret"]
}

export type ApiAuthProviderAuthProviderUpdateOutput = AuthProviderInfo

export type InstallationSelfOutput = InstallationSelf

export type InstallationAdminListOutput = InstallationAdminList

export type InstallationAdminGrantInput = {
  readonly accountID: { readonly accountID: string & Brand.Brand<"Account.ID"> }["accountID"]
}

export type InstallationAdminGrantOutput = InstallationAdminList

export type InstallationAdminRevokeInput = {
  readonly accountID: { readonly accountID: string & Brand.Brand<"Account.ID"> }["accountID"]
}

export type InstallationAdminRevokeOutput = InstallationAdminList

export type InstallationPolicyGetOutput = {
  providers?: { allow?: Array<string & Brand.Brand<"Provider.Name">> }
  plugins?: "off" | { allow: Array<string> }
  websearch?: "off"
  share?: "off"
  provisioning?: "open" | "invite-only"
  invitations?: { domains?: Array<string> }
}

export type InstallationPolicyUpdateInput = {
  readonly providers?: {
    readonly providers?: { readonly allow?: ReadonlyArray<string & Brand.Brand<"Provider.Name">> }
    readonly plugins?: "off" | { readonly allow: ReadonlyArray<string> }
    readonly websearch?: "off"
    readonly share?: "off"
    readonly provisioning?: "open" | "invite-only"
    readonly invitations?: { readonly domains?: ReadonlyArray<string> }
  }["providers"]
  readonly plugins?: {
    readonly providers?: { readonly allow?: ReadonlyArray<string & Brand.Brand<"Provider.Name">> }
    readonly plugins?: "off" | { readonly allow: ReadonlyArray<string> }
    readonly websearch?: "off"
    readonly share?: "off"
    readonly provisioning?: "open" | "invite-only"
    readonly invitations?: { readonly domains?: ReadonlyArray<string> }
  }["plugins"]
  readonly websearch?: {
    readonly providers?: { readonly allow?: ReadonlyArray<string & Brand.Brand<"Provider.Name">> }
    readonly plugins?: "off" | { readonly allow: ReadonlyArray<string> }
    readonly websearch?: "off"
    readonly share?: "off"
    readonly provisioning?: "open" | "invite-only"
    readonly invitations?: { readonly domains?: ReadonlyArray<string> }
  }["websearch"]
  readonly share?: {
    readonly providers?: { readonly allow?: ReadonlyArray<string & Brand.Brand<"Provider.Name">> }
    readonly plugins?: "off" | { readonly allow: ReadonlyArray<string> }
    readonly websearch?: "off"
    readonly share?: "off"
    readonly provisioning?: "open" | "invite-only"
    readonly invitations?: { readonly domains?: ReadonlyArray<string> }
  }["share"]
  readonly provisioning?: {
    readonly providers?: { readonly allow?: ReadonlyArray<string & Brand.Brand<"Provider.Name">> }
    readonly plugins?: "off" | { readonly allow: ReadonlyArray<string> }
    readonly websearch?: "off"
    readonly share?: "off"
    readonly provisioning?: "open" | "invite-only"
    readonly invitations?: { readonly domains?: ReadonlyArray<string> }
  }["provisioning"]
  readonly invitations?: {
    readonly providers?: { readonly allow?: ReadonlyArray<string & Brand.Brand<"Provider.Name">> }
    readonly plugins?: "off" | { readonly allow: ReadonlyArray<string> }
    readonly websearch?: "off"
    readonly share?: "off"
    readonly provisioning?: "open" | "invite-only"
    readonly invitations?: { readonly domains?: ReadonlyArray<string> }
  }["invitations"]
}

export type InstallationPolicyUpdateOutput = {
  providers?: { allow?: Array<string & Brand.Brand<"Provider.Name">> }
  plugins?: "off" | { allow: Array<string> }
  websearch?: "off"
  share?: "off"
  provisioning?: "open" | "invite-only"
  invitations?: { domains?: Array<string> }
}

export type ApiOauthRequestGetInput = {
  readonly id: { readonly id: string & Brand.Brand<"OAuthAuthorization.ID"> }["id"]
}

export type ApiOauthRequestGetOutput = { clientName: string; clientID: string & Brand.Brand<"OAuthClient.ID"> }

export type ApiOauthApproveInput = {
  readonly requestID: {
    readonly requestID: string & Brand.Brand<"OAuthAuthorization.ID">
    readonly workspaceID: string & Brand.Brand<"Workspace.ID">
  }["requestID"]
  readonly workspaceID: {
    readonly requestID: string & Brand.Brand<"OAuthAuthorization.ID">
    readonly workspaceID: string & Brand.Brand<"Workspace.ID">
  }["workspaceID"]
}

export type ApiOauthApproveOutput = { url: string }

export type ApiOauthDenyInput = {
  readonly requestID: { readonly requestID: string & Brand.Brand<"OAuthAuthorization.ID"> }["requestID"]
}

export type ApiOauthDenyOutput = { url: string }

export type UserListInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type UserListOutput = {
  role: "admin" | "member"
  members: Array<{
    id: string & Brand.Brand<"User.ID">
    email: string & Brand.Brand<"Auth.Email">
    role: "admin" | "member"
    status: "active" | "pending"
    accountID?: (string & Brand.Brand<"Account.ID">) | null
  }>
}

export type UserInviteInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly email: { readonly email: string & Brand.Brand<"Auth.Email">; readonly role: "admin" | "member" }["email"]
  readonly role: { readonly email: string & Brand.Brand<"Auth.Email">; readonly role: "admin" | "member" }["role"]
}

export type UserInviteOutput = {
  id: string & Brand.Brand<"User.ID">
  email: string & Brand.Brand<"Auth.Email">
  role: "admin" | "member"
  status: "active" | "pending"
  accountID?: (string & Brand.Brand<"Account.ID">) | null
}

export type UserRemoveInput = {
  readonly userID: { readonly userID: string & Brand.Brand<"User.ID"> }["userID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type UserRemoveOutput = void

export type ProviderListInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type ProviderListOutput = Array<ProviderDirectoryEntry>

export type ProviderUpdateInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly provider: {
    readonly provider: string & Brand.Brand<"Provider.Name">
    readonly status: "auto" | "enabled" | "disabled"
  }["provider"]
  readonly status: {
    readonly provider: string & Brand.Brand<"Provider.Name">
    readonly status: "auto" | "enabled" | "disabled"
  }["status"]
}

export type ProviderUpdateOutput = ProviderInfo

export type ApiConfigGetInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type ApiConfigGetOutput = {
  default_agent?: string & Brand.Brand<"Agent.ID">
  default_model?: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
  compaction: { auto: boolean; keep: { tokens: number }; buffer: number }
  permissions: PermissionRuleset
  plugins?: Array<string | ConfigPluginEntry> | undefined
  tool_output?: { max_lines: number; max_bytes: number } | undefined
  mcp?:
    | {
        servers?:
          | {
              [x: string]: {
                type: "remote"
                url: string
                headers?: { [x: string]: string } | undefined
                disabled?: boolean | undefined
                enabled?: boolean | undefined
                codemode?: boolean | undefined
                timeout?:
                  | { startup?: number | undefined; catalog?: number | undefined; execution?: number | undefined }
                  | undefined
                oauth?: false | { client_id?: string | undefined; scope?: string | undefined } | undefined
              }
            }
          | undefined
        activation?: { [x: string]: "enabled" | "disabled" } | undefined
      }
    | undefined
  websearch?: false | ConfigWebSearchInfo | undefined
  code_interpreter?: { implementation: string & Brand.Brand<"CodeInterpreter.ID"> } | undefined
  gateway?:
    | {
        limits?: { rpm?: number | undefined; tpm?: number | undefined } | undefined
        models?: Array<string> | undefined
      }
    | undefined
  providers?:
    | {
        allow?: Array<string & Brand.Brand<"Provider.Name">> | undefined
        activation?: { [x: string]: "auto" | "enabled" | "disabled" } | undefined
      }
    | undefined
  routing?:
    | Array<
        | {
            match: {
              model?: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
              purpose?: Array<"assistant" | "generate" | "compaction" | "title">
              text?: { pattern: string; flags?: string }
              context?: { min?: number; max?: number }
              images?: boolean
              agent?: string
              tool?: string
            }
            to:
              | {
                  tiers: Array<{
                    name: string
                    model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
                    description: string
                  }>
                  default: string
                  judge: {
                    model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
                    instructions?: string
                    window?: number
                    timeout?: number
                  }
                }
              | { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
          }
        | {
            match: {
              model?: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
              purpose?: Array<"assistant" | "generate" | "compaction" | "title">
              text?: { pattern: string; flags?: string }
              context?: { min?: number; max?: number }
              images?: boolean
              agent?: string
              tool?: string
            }
            to:
              | {
                  tiers: Array<{
                    name: string
                    model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
                    description: string
                  }>
                  default: string
                  judge: {
                    model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
                    instructions?: string
                    window?: number
                    timeout?: number
                  }
                }
              | { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
          }
      >
    | undefined
  models?: Array<ModelCustom> | undefined
  model_policy: {
    disabled: Array<{ provider: string & Brand.Brand<"Provider.Name">; id: string }>
    seen: Array<{ provider: string & Brand.Brand<"Provider.Name">; id: string }>
    initialized: Array<string & Brand.Brand<"Provider.Name">>
  }
}

export type ApiConfigUpdateInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly default_agent?: {
    readonly default_agent?: string & Brand.Brand<"Agent.ID">
    readonly compaction?: {
      readonly auto?: boolean
      readonly keep?: { readonly tokens?: number }
      readonly buffer?: number
    }
    readonly permissions?: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: string & Brand.Brand<"User.ID">
    }>
    readonly plugins?: ReadonlyArray<
      string | { readonly package: string; readonly options?: { readonly [x: string]: unknown } }
    >
    readonly tool_output?: { readonly max_lines?: number; readonly max_bytes?: number }
    readonly mcp?: {
      readonly servers?: {
        readonly [x: string]: {
          readonly type: "remote"
          readonly url: string
          readonly headers?: { readonly [x: string]: string }
          readonly disabled?: boolean
          readonly enabled?: boolean
          readonly codemode?: boolean
          readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
          readonly oauth?: false | { readonly client_id?: string; readonly scope?: string }
        }
      }
      readonly activation?: { readonly [x: string]: "enabled" | "disabled" }
    }
    readonly websearch?: false | { readonly provider: "random" | ((string & {}) & Brand.Brand<"WebSearch.ID">) }
    readonly code_interpreter?: { readonly implementation: string & Brand.Brand<"CodeInterpreter.ID"> }
    readonly gateway?: {
      readonly limits?: { readonly rpm?: number; readonly tpm?: number }
      readonly models?: ReadonlyArray<string>
    }
    readonly providers?: {
      readonly allow?: ReadonlyArray<string & Brand.Brand<"Provider.Name">>
      readonly activation?: { readonly [x: string]: "auto" | "enabled" | "disabled" }
    }
    readonly routing?: ReadonlyArray<
      | {
          readonly match: {
            readonly model?: {
              readonly id: string
              readonly provider: string & Brand.Brand<"Provider.Name">
              readonly variant?: string
            }
            readonly purpose?: ReadonlyArray<"assistant" | "generate" | "compaction" | "title">
            readonly text?: { readonly pattern: string; readonly flags?: string }
            readonly context?: { readonly min?: number; readonly max?: number }
            readonly images?: boolean
            readonly agent?: string
            readonly tool?: string
          }
          readonly to:
            | {
                readonly tiers: ReadonlyArray<{
                  readonly name: string
                  readonly model: {
                    readonly id: string
                    readonly provider: string & Brand.Brand<"Provider.Name">
                    readonly variant?: string
                  }
                  readonly description: string
                }>
                readonly default: string
                readonly judge: {
                  readonly model: {
                    readonly id: string
                    readonly provider: string & Brand.Brand<"Provider.Name">
                    readonly variant?: string
                  }
                  readonly instructions?: string
                  readonly window?: number
                  readonly timeout?: number
                }
              }
            | {
                readonly id: string
                readonly provider: string & Brand.Brand<"Provider.Name">
                readonly variant?: string
              }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly from: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly when: { readonly tool: string }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly from: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly when: { readonly tool: string }
        }
    >
    readonly models?: ReadonlyArray<{
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly id: string
      readonly name: string
      readonly apiID: string
      readonly cost?: { readonly input?: number; readonly output?: number }
      readonly limit?: { readonly context?: number }
    }>
  }["default_agent"]
  readonly compaction?: {
    readonly default_agent?: string & Brand.Brand<"Agent.ID">
    readonly compaction?: {
      readonly auto?: boolean
      readonly keep?: { readonly tokens?: number }
      readonly buffer?: number
    }
    readonly permissions?: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: string & Brand.Brand<"User.ID">
    }>
    readonly plugins?: ReadonlyArray<
      string | { readonly package: string; readonly options?: { readonly [x: string]: unknown } }
    >
    readonly tool_output?: { readonly max_lines?: number; readonly max_bytes?: number }
    readonly mcp?: {
      readonly servers?: {
        readonly [x: string]: {
          readonly type: "remote"
          readonly url: string
          readonly headers?: { readonly [x: string]: string }
          readonly disabled?: boolean
          readonly enabled?: boolean
          readonly codemode?: boolean
          readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
          readonly oauth?: false | { readonly client_id?: string; readonly scope?: string }
        }
      }
      readonly activation?: { readonly [x: string]: "enabled" | "disabled" }
    }
    readonly websearch?: false | { readonly provider: "random" | ((string & {}) & Brand.Brand<"WebSearch.ID">) }
    readonly code_interpreter?: { readonly implementation: string & Brand.Brand<"CodeInterpreter.ID"> }
    readonly gateway?: {
      readonly limits?: { readonly rpm?: number; readonly tpm?: number }
      readonly models?: ReadonlyArray<string>
    }
    readonly providers?: {
      readonly allow?: ReadonlyArray<string & Brand.Brand<"Provider.Name">>
      readonly activation?: { readonly [x: string]: "auto" | "enabled" | "disabled" }
    }
    readonly routing?: ReadonlyArray<
      | {
          readonly match: {
            readonly model?: {
              readonly id: string
              readonly provider: string & Brand.Brand<"Provider.Name">
              readonly variant?: string
            }
            readonly purpose?: ReadonlyArray<"assistant" | "generate" | "compaction" | "title">
            readonly text?: { readonly pattern: string; readonly flags?: string }
            readonly context?: { readonly min?: number; readonly max?: number }
            readonly images?: boolean
            readonly agent?: string
            readonly tool?: string
          }
          readonly to:
            | {
                readonly tiers: ReadonlyArray<{
                  readonly name: string
                  readonly model: {
                    readonly id: string
                    readonly provider: string & Brand.Brand<"Provider.Name">
                    readonly variant?: string
                  }
                  readonly description: string
                }>
                readonly default: string
                readonly judge: {
                  readonly model: {
                    readonly id: string
                    readonly provider: string & Brand.Brand<"Provider.Name">
                    readonly variant?: string
                  }
                  readonly instructions?: string
                  readonly window?: number
                  readonly timeout?: number
                }
              }
            | {
                readonly id: string
                readonly provider: string & Brand.Brand<"Provider.Name">
                readonly variant?: string
              }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly from: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly when: { readonly tool: string }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly from: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly when: { readonly tool: string }
        }
    >
    readonly models?: ReadonlyArray<{
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly id: string
      readonly name: string
      readonly apiID: string
      readonly cost?: { readonly input?: number; readonly output?: number }
      readonly limit?: { readonly context?: number }
    }>
  }["compaction"]
  readonly permissions?: {
    readonly default_agent?: string & Brand.Brand<"Agent.ID">
    readonly compaction?: {
      readonly auto?: boolean
      readonly keep?: { readonly tokens?: number }
      readonly buffer?: number
    }
    readonly permissions?: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: string & Brand.Brand<"User.ID">
    }>
    readonly plugins?: ReadonlyArray<
      string | { readonly package: string; readonly options?: { readonly [x: string]: unknown } }
    >
    readonly tool_output?: { readonly max_lines?: number; readonly max_bytes?: number }
    readonly mcp?: {
      readonly servers?: {
        readonly [x: string]: {
          readonly type: "remote"
          readonly url: string
          readonly headers?: { readonly [x: string]: string }
          readonly disabled?: boolean
          readonly enabled?: boolean
          readonly codemode?: boolean
          readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
          readonly oauth?: false | { readonly client_id?: string; readonly scope?: string }
        }
      }
      readonly activation?: { readonly [x: string]: "enabled" | "disabled" }
    }
    readonly websearch?: false | { readonly provider: "random" | ((string & {}) & Brand.Brand<"WebSearch.ID">) }
    readonly code_interpreter?: { readonly implementation: string & Brand.Brand<"CodeInterpreter.ID"> }
    readonly gateway?: {
      readonly limits?: { readonly rpm?: number; readonly tpm?: number }
      readonly models?: ReadonlyArray<string>
    }
    readonly providers?: {
      readonly allow?: ReadonlyArray<string & Brand.Brand<"Provider.Name">>
      readonly activation?: { readonly [x: string]: "auto" | "enabled" | "disabled" }
    }
    readonly routing?: ReadonlyArray<
      | {
          readonly match: {
            readonly model?: {
              readonly id: string
              readonly provider: string & Brand.Brand<"Provider.Name">
              readonly variant?: string
            }
            readonly purpose?: ReadonlyArray<"assistant" | "generate" | "compaction" | "title">
            readonly text?: { readonly pattern: string; readonly flags?: string }
            readonly context?: { readonly min?: number; readonly max?: number }
            readonly images?: boolean
            readonly agent?: string
            readonly tool?: string
          }
          readonly to:
            | {
                readonly tiers: ReadonlyArray<{
                  readonly name: string
                  readonly model: {
                    readonly id: string
                    readonly provider: string & Brand.Brand<"Provider.Name">
                    readonly variant?: string
                  }
                  readonly description: string
                }>
                readonly default: string
                readonly judge: {
                  readonly model: {
                    readonly id: string
                    readonly provider: string & Brand.Brand<"Provider.Name">
                    readonly variant?: string
                  }
                  readonly instructions?: string
                  readonly window?: number
                  readonly timeout?: number
                }
              }
            | {
                readonly id: string
                readonly provider: string & Brand.Brand<"Provider.Name">
                readonly variant?: string
              }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly from: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly when: { readonly tool: string }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly from: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly when: { readonly tool: string }
        }
    >
    readonly models?: ReadonlyArray<{
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly id: string
      readonly name: string
      readonly apiID: string
      readonly cost?: { readonly input?: number; readonly output?: number }
      readonly limit?: { readonly context?: number }
    }>
  }["permissions"]
  readonly plugins?: {
    readonly default_agent?: string & Brand.Brand<"Agent.ID">
    readonly compaction?: {
      readonly auto?: boolean
      readonly keep?: { readonly tokens?: number }
      readonly buffer?: number
    }
    readonly permissions?: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: string & Brand.Brand<"User.ID">
    }>
    readonly plugins?: ReadonlyArray<
      string | { readonly package: string; readonly options?: { readonly [x: string]: unknown } }
    >
    readonly tool_output?: { readonly max_lines?: number; readonly max_bytes?: number }
    readonly mcp?: {
      readonly servers?: {
        readonly [x: string]: {
          readonly type: "remote"
          readonly url: string
          readonly headers?: { readonly [x: string]: string }
          readonly disabled?: boolean
          readonly enabled?: boolean
          readonly codemode?: boolean
          readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
          readonly oauth?: false | { readonly client_id?: string; readonly scope?: string }
        }
      }
      readonly activation?: { readonly [x: string]: "enabled" | "disabled" }
    }
    readonly websearch?: false | { readonly provider: "random" | ((string & {}) & Brand.Brand<"WebSearch.ID">) }
    readonly code_interpreter?: { readonly implementation: string & Brand.Brand<"CodeInterpreter.ID"> }
    readonly gateway?: {
      readonly limits?: { readonly rpm?: number; readonly tpm?: number }
      readonly models?: ReadonlyArray<string>
    }
    readonly providers?: {
      readonly allow?: ReadonlyArray<string & Brand.Brand<"Provider.Name">>
      readonly activation?: { readonly [x: string]: "auto" | "enabled" | "disabled" }
    }
    readonly routing?: ReadonlyArray<
      | {
          readonly match: {
            readonly model?: {
              readonly id: string
              readonly provider: string & Brand.Brand<"Provider.Name">
              readonly variant?: string
            }
            readonly purpose?: ReadonlyArray<"assistant" | "generate" | "compaction" | "title">
            readonly text?: { readonly pattern: string; readonly flags?: string }
            readonly context?: { readonly min?: number; readonly max?: number }
            readonly images?: boolean
            readonly agent?: string
            readonly tool?: string
          }
          readonly to:
            | {
                readonly tiers: ReadonlyArray<{
                  readonly name: string
                  readonly model: {
                    readonly id: string
                    readonly provider: string & Brand.Brand<"Provider.Name">
                    readonly variant?: string
                  }
                  readonly description: string
                }>
                readonly default: string
                readonly judge: {
                  readonly model: {
                    readonly id: string
                    readonly provider: string & Brand.Brand<"Provider.Name">
                    readonly variant?: string
                  }
                  readonly instructions?: string
                  readonly window?: number
                  readonly timeout?: number
                }
              }
            | {
                readonly id: string
                readonly provider: string & Brand.Brand<"Provider.Name">
                readonly variant?: string
              }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly from: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly when: { readonly tool: string }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly from: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly when: { readonly tool: string }
        }
    >
    readonly models?: ReadonlyArray<{
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly id: string
      readonly name: string
      readonly apiID: string
      readonly cost?: { readonly input?: number; readonly output?: number }
      readonly limit?: { readonly context?: number }
    }>
  }["plugins"]
  readonly tool_output?: {
    readonly default_agent?: string & Brand.Brand<"Agent.ID">
    readonly compaction?: {
      readonly auto?: boolean
      readonly keep?: { readonly tokens?: number }
      readonly buffer?: number
    }
    readonly permissions?: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: string & Brand.Brand<"User.ID">
    }>
    readonly plugins?: ReadonlyArray<
      string | { readonly package: string; readonly options?: { readonly [x: string]: unknown } }
    >
    readonly tool_output?: { readonly max_lines?: number; readonly max_bytes?: number }
    readonly mcp?: {
      readonly servers?: {
        readonly [x: string]: {
          readonly type: "remote"
          readonly url: string
          readonly headers?: { readonly [x: string]: string }
          readonly disabled?: boolean
          readonly enabled?: boolean
          readonly codemode?: boolean
          readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
          readonly oauth?: false | { readonly client_id?: string; readonly scope?: string }
        }
      }
      readonly activation?: { readonly [x: string]: "enabled" | "disabled" }
    }
    readonly websearch?: false | { readonly provider: "random" | ((string & {}) & Brand.Brand<"WebSearch.ID">) }
    readonly code_interpreter?: { readonly implementation: string & Brand.Brand<"CodeInterpreter.ID"> }
    readonly gateway?: {
      readonly limits?: { readonly rpm?: number; readonly tpm?: number }
      readonly models?: ReadonlyArray<string>
    }
    readonly providers?: {
      readonly allow?: ReadonlyArray<string & Brand.Brand<"Provider.Name">>
      readonly activation?: { readonly [x: string]: "auto" | "enabled" | "disabled" }
    }
    readonly routing?: ReadonlyArray<
      | {
          readonly match: {
            readonly model?: {
              readonly id: string
              readonly provider: string & Brand.Brand<"Provider.Name">
              readonly variant?: string
            }
            readonly purpose?: ReadonlyArray<"assistant" | "generate" | "compaction" | "title">
            readonly text?: { readonly pattern: string; readonly flags?: string }
            readonly context?: { readonly min?: number; readonly max?: number }
            readonly images?: boolean
            readonly agent?: string
            readonly tool?: string
          }
          readonly to:
            | {
                readonly tiers: ReadonlyArray<{
                  readonly name: string
                  readonly model: {
                    readonly id: string
                    readonly provider: string & Brand.Brand<"Provider.Name">
                    readonly variant?: string
                  }
                  readonly description: string
                }>
                readonly default: string
                readonly judge: {
                  readonly model: {
                    readonly id: string
                    readonly provider: string & Brand.Brand<"Provider.Name">
                    readonly variant?: string
                  }
                  readonly instructions?: string
                  readonly window?: number
                  readonly timeout?: number
                }
              }
            | {
                readonly id: string
                readonly provider: string & Brand.Brand<"Provider.Name">
                readonly variant?: string
              }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly from: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly when: { readonly tool: string }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly from: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly when: { readonly tool: string }
        }
    >
    readonly models?: ReadonlyArray<{
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly id: string
      readonly name: string
      readonly apiID: string
      readonly cost?: { readonly input?: number; readonly output?: number }
      readonly limit?: { readonly context?: number }
    }>
  }["tool_output"]
  readonly mcp?: {
    readonly default_agent?: string & Brand.Brand<"Agent.ID">
    readonly compaction?: {
      readonly auto?: boolean
      readonly keep?: { readonly tokens?: number }
      readonly buffer?: number
    }
    readonly permissions?: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: string & Brand.Brand<"User.ID">
    }>
    readonly plugins?: ReadonlyArray<
      string | { readonly package: string; readonly options?: { readonly [x: string]: unknown } }
    >
    readonly tool_output?: { readonly max_lines?: number; readonly max_bytes?: number }
    readonly mcp?: {
      readonly servers?: {
        readonly [x: string]: {
          readonly type: "remote"
          readonly url: string
          readonly headers?: { readonly [x: string]: string }
          readonly disabled?: boolean
          readonly enabled?: boolean
          readonly codemode?: boolean
          readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
          readonly oauth?: false | { readonly client_id?: string; readonly scope?: string }
        }
      }
      readonly activation?: { readonly [x: string]: "enabled" | "disabled" }
    }
    readonly websearch?: false | { readonly provider: "random" | ((string & {}) & Brand.Brand<"WebSearch.ID">) }
    readonly code_interpreter?: { readonly implementation: string & Brand.Brand<"CodeInterpreter.ID"> }
    readonly gateway?: {
      readonly limits?: { readonly rpm?: number; readonly tpm?: number }
      readonly models?: ReadonlyArray<string>
    }
    readonly providers?: {
      readonly allow?: ReadonlyArray<string & Brand.Brand<"Provider.Name">>
      readonly activation?: { readonly [x: string]: "auto" | "enabled" | "disabled" }
    }
    readonly routing?: ReadonlyArray<
      | {
          readonly match: {
            readonly model?: {
              readonly id: string
              readonly provider: string & Brand.Brand<"Provider.Name">
              readonly variant?: string
            }
            readonly purpose?: ReadonlyArray<"assistant" | "generate" | "compaction" | "title">
            readonly text?: { readonly pattern: string; readonly flags?: string }
            readonly context?: { readonly min?: number; readonly max?: number }
            readonly images?: boolean
            readonly agent?: string
            readonly tool?: string
          }
          readonly to:
            | {
                readonly tiers: ReadonlyArray<{
                  readonly name: string
                  readonly model: {
                    readonly id: string
                    readonly provider: string & Brand.Brand<"Provider.Name">
                    readonly variant?: string
                  }
                  readonly description: string
                }>
                readonly default: string
                readonly judge: {
                  readonly model: {
                    readonly id: string
                    readonly provider: string & Brand.Brand<"Provider.Name">
                    readonly variant?: string
                  }
                  readonly instructions?: string
                  readonly window?: number
                  readonly timeout?: number
                }
              }
            | {
                readonly id: string
                readonly provider: string & Brand.Brand<"Provider.Name">
                readonly variant?: string
              }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly from: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly when: { readonly tool: string }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly from: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly when: { readonly tool: string }
        }
    >
    readonly models?: ReadonlyArray<{
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly id: string
      readonly name: string
      readonly apiID: string
      readonly cost?: { readonly input?: number; readonly output?: number }
      readonly limit?: { readonly context?: number }
    }>
  }["mcp"]
  readonly websearch?: {
    readonly default_agent?: string & Brand.Brand<"Agent.ID">
    readonly compaction?: {
      readonly auto?: boolean
      readonly keep?: { readonly tokens?: number }
      readonly buffer?: number
    }
    readonly permissions?: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: string & Brand.Brand<"User.ID">
    }>
    readonly plugins?: ReadonlyArray<
      string | { readonly package: string; readonly options?: { readonly [x: string]: unknown } }
    >
    readonly tool_output?: { readonly max_lines?: number; readonly max_bytes?: number }
    readonly mcp?: {
      readonly servers?: {
        readonly [x: string]: {
          readonly type: "remote"
          readonly url: string
          readonly headers?: { readonly [x: string]: string }
          readonly disabled?: boolean
          readonly enabled?: boolean
          readonly codemode?: boolean
          readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
          readonly oauth?: false | { readonly client_id?: string; readonly scope?: string }
        }
      }
      readonly activation?: { readonly [x: string]: "enabled" | "disabled" }
    }
    readonly websearch?: false | { readonly provider: "random" | ((string & {}) & Brand.Brand<"WebSearch.ID">) }
    readonly code_interpreter?: { readonly implementation: string & Brand.Brand<"CodeInterpreter.ID"> }
    readonly gateway?: {
      readonly limits?: { readonly rpm?: number; readonly tpm?: number }
      readonly models?: ReadonlyArray<string>
    }
    readonly providers?: {
      readonly allow?: ReadonlyArray<string & Brand.Brand<"Provider.Name">>
      readonly activation?: { readonly [x: string]: "auto" | "enabled" | "disabled" }
    }
    readonly routing?: ReadonlyArray<
      | {
          readonly match: {
            readonly model?: {
              readonly id: string
              readonly provider: string & Brand.Brand<"Provider.Name">
              readonly variant?: string
            }
            readonly purpose?: ReadonlyArray<"assistant" | "generate" | "compaction" | "title">
            readonly text?: { readonly pattern: string; readonly flags?: string }
            readonly context?: { readonly min?: number; readonly max?: number }
            readonly images?: boolean
            readonly agent?: string
            readonly tool?: string
          }
          readonly to:
            | {
                readonly tiers: ReadonlyArray<{
                  readonly name: string
                  readonly model: {
                    readonly id: string
                    readonly provider: string & Brand.Brand<"Provider.Name">
                    readonly variant?: string
                  }
                  readonly description: string
                }>
                readonly default: string
                readonly judge: {
                  readonly model: {
                    readonly id: string
                    readonly provider: string & Brand.Brand<"Provider.Name">
                    readonly variant?: string
                  }
                  readonly instructions?: string
                  readonly window?: number
                  readonly timeout?: number
                }
              }
            | {
                readonly id: string
                readonly provider: string & Brand.Brand<"Provider.Name">
                readonly variant?: string
              }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly from: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly when: { readonly tool: string }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly from: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly when: { readonly tool: string }
        }
    >
    readonly models?: ReadonlyArray<{
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly id: string
      readonly name: string
      readonly apiID: string
      readonly cost?: { readonly input?: number; readonly output?: number }
      readonly limit?: { readonly context?: number }
    }>
  }["websearch"]
  readonly code_interpreter?: {
    readonly default_agent?: string & Brand.Brand<"Agent.ID">
    readonly compaction?: {
      readonly auto?: boolean
      readonly keep?: { readonly tokens?: number }
      readonly buffer?: number
    }
    readonly permissions?: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: string & Brand.Brand<"User.ID">
    }>
    readonly plugins?: ReadonlyArray<
      string | { readonly package: string; readonly options?: { readonly [x: string]: unknown } }
    >
    readonly tool_output?: { readonly max_lines?: number; readonly max_bytes?: number }
    readonly mcp?: {
      readonly servers?: {
        readonly [x: string]: {
          readonly type: "remote"
          readonly url: string
          readonly headers?: { readonly [x: string]: string }
          readonly disabled?: boolean
          readonly enabled?: boolean
          readonly codemode?: boolean
          readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
          readonly oauth?: false | { readonly client_id?: string; readonly scope?: string }
        }
      }
      readonly activation?: { readonly [x: string]: "enabled" | "disabled" }
    }
    readonly websearch?: false | { readonly provider: "random" | ((string & {}) & Brand.Brand<"WebSearch.ID">) }
    readonly code_interpreter?: { readonly implementation: string & Brand.Brand<"CodeInterpreter.ID"> }
    readonly gateway?: {
      readonly limits?: { readonly rpm?: number; readonly tpm?: number }
      readonly models?: ReadonlyArray<string>
    }
    readonly providers?: {
      readonly allow?: ReadonlyArray<string & Brand.Brand<"Provider.Name">>
      readonly activation?: { readonly [x: string]: "auto" | "enabled" | "disabled" }
    }
    readonly routing?: ReadonlyArray<
      | {
          readonly match: {
            readonly model?: {
              readonly id: string
              readonly provider: string & Brand.Brand<"Provider.Name">
              readonly variant?: string
            }
            readonly purpose?: ReadonlyArray<"assistant" | "generate" | "compaction" | "title">
            readonly text?: { readonly pattern: string; readonly flags?: string }
            readonly context?: { readonly min?: number; readonly max?: number }
            readonly images?: boolean
            readonly agent?: string
            readonly tool?: string
          }
          readonly to:
            | {
                readonly tiers: ReadonlyArray<{
                  readonly name: string
                  readonly model: {
                    readonly id: string
                    readonly provider: string & Brand.Brand<"Provider.Name">
                    readonly variant?: string
                  }
                  readonly description: string
                }>
                readonly default: string
                readonly judge: {
                  readonly model: {
                    readonly id: string
                    readonly provider: string & Brand.Brand<"Provider.Name">
                    readonly variant?: string
                  }
                  readonly instructions?: string
                  readonly window?: number
                  readonly timeout?: number
                }
              }
            | {
                readonly id: string
                readonly provider: string & Brand.Brand<"Provider.Name">
                readonly variant?: string
              }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly from: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly when: { readonly tool: string }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly from: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly when: { readonly tool: string }
        }
    >
    readonly models?: ReadonlyArray<{
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly id: string
      readonly name: string
      readonly apiID: string
      readonly cost?: { readonly input?: number; readonly output?: number }
      readonly limit?: { readonly context?: number }
    }>
  }["code_interpreter"]
  readonly gateway?: {
    readonly default_agent?: string & Brand.Brand<"Agent.ID">
    readonly compaction?: {
      readonly auto?: boolean
      readonly keep?: { readonly tokens?: number }
      readonly buffer?: number
    }
    readonly permissions?: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: string & Brand.Brand<"User.ID">
    }>
    readonly plugins?: ReadonlyArray<
      string | { readonly package: string; readonly options?: { readonly [x: string]: unknown } }
    >
    readonly tool_output?: { readonly max_lines?: number; readonly max_bytes?: number }
    readonly mcp?: {
      readonly servers?: {
        readonly [x: string]: {
          readonly type: "remote"
          readonly url: string
          readonly headers?: { readonly [x: string]: string }
          readonly disabled?: boolean
          readonly enabled?: boolean
          readonly codemode?: boolean
          readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
          readonly oauth?: false | { readonly client_id?: string; readonly scope?: string }
        }
      }
      readonly activation?: { readonly [x: string]: "enabled" | "disabled" }
    }
    readonly websearch?: false | { readonly provider: "random" | ((string & {}) & Brand.Brand<"WebSearch.ID">) }
    readonly code_interpreter?: { readonly implementation: string & Brand.Brand<"CodeInterpreter.ID"> }
    readonly gateway?: {
      readonly limits?: { readonly rpm?: number; readonly tpm?: number }
      readonly models?: ReadonlyArray<string>
    }
    readonly providers?: {
      readonly allow?: ReadonlyArray<string & Brand.Brand<"Provider.Name">>
      readonly activation?: { readonly [x: string]: "auto" | "enabled" | "disabled" }
    }
    readonly routing?: ReadonlyArray<
      | {
          readonly match: {
            readonly model?: {
              readonly id: string
              readonly provider: string & Brand.Brand<"Provider.Name">
              readonly variant?: string
            }
            readonly purpose?: ReadonlyArray<"assistant" | "generate" | "compaction" | "title">
            readonly text?: { readonly pattern: string; readonly flags?: string }
            readonly context?: { readonly min?: number; readonly max?: number }
            readonly images?: boolean
            readonly agent?: string
            readonly tool?: string
          }
          readonly to:
            | {
                readonly tiers: ReadonlyArray<{
                  readonly name: string
                  readonly model: {
                    readonly id: string
                    readonly provider: string & Brand.Brand<"Provider.Name">
                    readonly variant?: string
                  }
                  readonly description: string
                }>
                readonly default: string
                readonly judge: {
                  readonly model: {
                    readonly id: string
                    readonly provider: string & Brand.Brand<"Provider.Name">
                    readonly variant?: string
                  }
                  readonly instructions?: string
                  readonly window?: number
                  readonly timeout?: number
                }
              }
            | {
                readonly id: string
                readonly provider: string & Brand.Brand<"Provider.Name">
                readonly variant?: string
              }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly from: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly when: { readonly tool: string }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly from: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly when: { readonly tool: string }
        }
    >
    readonly models?: ReadonlyArray<{
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly id: string
      readonly name: string
      readonly apiID: string
      readonly cost?: { readonly input?: number; readonly output?: number }
      readonly limit?: { readonly context?: number }
    }>
  }["gateway"]
  readonly providers?: {
    readonly default_agent?: string & Brand.Brand<"Agent.ID">
    readonly compaction?: {
      readonly auto?: boolean
      readonly keep?: { readonly tokens?: number }
      readonly buffer?: number
    }
    readonly permissions?: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: string & Brand.Brand<"User.ID">
    }>
    readonly plugins?: ReadonlyArray<
      string | { readonly package: string; readonly options?: { readonly [x: string]: unknown } }
    >
    readonly tool_output?: { readonly max_lines?: number; readonly max_bytes?: number }
    readonly mcp?: {
      readonly servers?: {
        readonly [x: string]: {
          readonly type: "remote"
          readonly url: string
          readonly headers?: { readonly [x: string]: string }
          readonly disabled?: boolean
          readonly enabled?: boolean
          readonly codemode?: boolean
          readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
          readonly oauth?: false | { readonly client_id?: string; readonly scope?: string }
        }
      }
      readonly activation?: { readonly [x: string]: "enabled" | "disabled" }
    }
    readonly websearch?: false | { readonly provider: "random" | ((string & {}) & Brand.Brand<"WebSearch.ID">) }
    readonly code_interpreter?: { readonly implementation: string & Brand.Brand<"CodeInterpreter.ID"> }
    readonly gateway?: {
      readonly limits?: { readonly rpm?: number; readonly tpm?: number }
      readonly models?: ReadonlyArray<string>
    }
    readonly providers?: {
      readonly allow?: ReadonlyArray<string & Brand.Brand<"Provider.Name">>
      readonly activation?: { readonly [x: string]: "auto" | "enabled" | "disabled" }
    }
    readonly routing?: ReadonlyArray<
      | {
          readonly match: {
            readonly model?: {
              readonly id: string
              readonly provider: string & Brand.Brand<"Provider.Name">
              readonly variant?: string
            }
            readonly purpose?: ReadonlyArray<"assistant" | "generate" | "compaction" | "title">
            readonly text?: { readonly pattern: string; readonly flags?: string }
            readonly context?: { readonly min?: number; readonly max?: number }
            readonly images?: boolean
            readonly agent?: string
            readonly tool?: string
          }
          readonly to:
            | {
                readonly tiers: ReadonlyArray<{
                  readonly name: string
                  readonly model: {
                    readonly id: string
                    readonly provider: string & Brand.Brand<"Provider.Name">
                    readonly variant?: string
                  }
                  readonly description: string
                }>
                readonly default: string
                readonly judge: {
                  readonly model: {
                    readonly id: string
                    readonly provider: string & Brand.Brand<"Provider.Name">
                    readonly variant?: string
                  }
                  readonly instructions?: string
                  readonly window?: number
                  readonly timeout?: number
                }
              }
            | {
                readonly id: string
                readonly provider: string & Brand.Brand<"Provider.Name">
                readonly variant?: string
              }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly from: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly when: { readonly tool: string }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly from: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly when: { readonly tool: string }
        }
    >
    readonly models?: ReadonlyArray<{
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly id: string
      readonly name: string
      readonly apiID: string
      readonly cost?: { readonly input?: number; readonly output?: number }
      readonly limit?: { readonly context?: number }
    }>
  }["providers"]
  readonly routing?: {
    readonly default_agent?: string & Brand.Brand<"Agent.ID">
    readonly compaction?: {
      readonly auto?: boolean
      readonly keep?: { readonly tokens?: number }
      readonly buffer?: number
    }
    readonly permissions?: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: string & Brand.Brand<"User.ID">
    }>
    readonly plugins?: ReadonlyArray<
      string | { readonly package: string; readonly options?: { readonly [x: string]: unknown } }
    >
    readonly tool_output?: { readonly max_lines?: number; readonly max_bytes?: number }
    readonly mcp?: {
      readonly servers?: {
        readonly [x: string]: {
          readonly type: "remote"
          readonly url: string
          readonly headers?: { readonly [x: string]: string }
          readonly disabled?: boolean
          readonly enabled?: boolean
          readonly codemode?: boolean
          readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
          readonly oauth?: false | { readonly client_id?: string; readonly scope?: string }
        }
      }
      readonly activation?: { readonly [x: string]: "enabled" | "disabled" }
    }
    readonly websearch?: false | { readonly provider: "random" | ((string & {}) & Brand.Brand<"WebSearch.ID">) }
    readonly code_interpreter?: { readonly implementation: string & Brand.Brand<"CodeInterpreter.ID"> }
    readonly gateway?: {
      readonly limits?: { readonly rpm?: number; readonly tpm?: number }
      readonly models?: ReadonlyArray<string>
    }
    readonly providers?: {
      readonly allow?: ReadonlyArray<string & Brand.Brand<"Provider.Name">>
      readonly activation?: { readonly [x: string]: "auto" | "enabled" | "disabled" }
    }
    readonly routing?: ReadonlyArray<
      | {
          readonly match: {
            readonly model?: {
              readonly id: string
              readonly provider: string & Brand.Brand<"Provider.Name">
              readonly variant?: string
            }
            readonly purpose?: ReadonlyArray<"assistant" | "generate" | "compaction" | "title">
            readonly text?: { readonly pattern: string; readonly flags?: string }
            readonly context?: { readonly min?: number; readonly max?: number }
            readonly images?: boolean
            readonly agent?: string
            readonly tool?: string
          }
          readonly to:
            | {
                readonly tiers: ReadonlyArray<{
                  readonly name: string
                  readonly model: {
                    readonly id: string
                    readonly provider: string & Brand.Brand<"Provider.Name">
                    readonly variant?: string
                  }
                  readonly description: string
                }>
                readonly default: string
                readonly judge: {
                  readonly model: {
                    readonly id: string
                    readonly provider: string & Brand.Brand<"Provider.Name">
                    readonly variant?: string
                  }
                  readonly instructions?: string
                  readonly window?: number
                  readonly timeout?: number
                }
              }
            | {
                readonly id: string
                readonly provider: string & Brand.Brand<"Provider.Name">
                readonly variant?: string
              }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly from: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly when: { readonly tool: string }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly from: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly when: { readonly tool: string }
        }
    >
    readonly models?: ReadonlyArray<{
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly id: string
      readonly name: string
      readonly apiID: string
      readonly cost?: { readonly input?: number; readonly output?: number }
      readonly limit?: { readonly context?: number }
    }>
  }["routing"]
  readonly models?: {
    readonly default_agent?: string & Brand.Brand<"Agent.ID">
    readonly compaction?: {
      readonly auto?: boolean
      readonly keep?: { readonly tokens?: number }
      readonly buffer?: number
    }
    readonly permissions?: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: string & Brand.Brand<"User.ID">
    }>
    readonly plugins?: ReadonlyArray<
      string | { readonly package: string; readonly options?: { readonly [x: string]: unknown } }
    >
    readonly tool_output?: { readonly max_lines?: number; readonly max_bytes?: number }
    readonly mcp?: {
      readonly servers?: {
        readonly [x: string]: {
          readonly type: "remote"
          readonly url: string
          readonly headers?: { readonly [x: string]: string }
          readonly disabled?: boolean
          readonly enabled?: boolean
          readonly codemode?: boolean
          readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
          readonly oauth?: false | { readonly client_id?: string; readonly scope?: string }
        }
      }
      readonly activation?: { readonly [x: string]: "enabled" | "disabled" }
    }
    readonly websearch?: false | { readonly provider: "random" | ((string & {}) & Brand.Brand<"WebSearch.ID">) }
    readonly code_interpreter?: { readonly implementation: string & Brand.Brand<"CodeInterpreter.ID"> }
    readonly gateway?: {
      readonly limits?: { readonly rpm?: number; readonly tpm?: number }
      readonly models?: ReadonlyArray<string>
    }
    readonly providers?: {
      readonly allow?: ReadonlyArray<string & Brand.Brand<"Provider.Name">>
      readonly activation?: { readonly [x: string]: "auto" | "enabled" | "disabled" }
    }
    readonly routing?: ReadonlyArray<
      | {
          readonly match: {
            readonly model?: {
              readonly id: string
              readonly provider: string & Brand.Brand<"Provider.Name">
              readonly variant?: string
            }
            readonly purpose?: ReadonlyArray<"assistant" | "generate" | "compaction" | "title">
            readonly text?: { readonly pattern: string; readonly flags?: string }
            readonly context?: { readonly min?: number; readonly max?: number }
            readonly images?: boolean
            readonly agent?: string
            readonly tool?: string
          }
          readonly to:
            | {
                readonly tiers: ReadonlyArray<{
                  readonly name: string
                  readonly model: {
                    readonly id: string
                    readonly provider: string & Brand.Brand<"Provider.Name">
                    readonly variant?: string
                  }
                  readonly description: string
                }>
                readonly default: string
                readonly judge: {
                  readonly model: {
                    readonly id: string
                    readonly provider: string & Brand.Brand<"Provider.Name">
                    readonly variant?: string
                  }
                  readonly instructions?: string
                  readonly window?: number
                  readonly timeout?: number
                }
              }
            | {
                readonly id: string
                readonly provider: string & Brand.Brand<"Provider.Name">
                readonly variant?: string
              }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly from: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly when: { readonly tool: string }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly from: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
        }
      | {
          readonly to: {
            readonly id: string
            readonly provider: string & Brand.Brand<"Provider.Name">
            readonly variant?: string
          }
          readonly when: { readonly tool: string }
        }
    >
    readonly models?: ReadonlyArray<{
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly id: string
      readonly name: string
      readonly apiID: string
      readonly cost?: { readonly input?: number; readonly output?: number }
      readonly limit?: { readonly context?: number }
    }>
  }["models"]
}

export type ApiConfigUpdateOutput = {
  default_agent?: string & Brand.Brand<"Agent.ID">
  default_model?: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
  compaction: { auto: boolean; keep: { tokens: number }; buffer: number }
  permissions: PermissionRuleset
  plugins?: Array<string | ConfigPluginEntry> | undefined
  tool_output?: { max_lines: number; max_bytes: number } | undefined
  mcp?:
    | {
        servers?:
          | {
              [x: string]: {
                type: "remote"
                url: string
                headers?: { [x: string]: string } | undefined
                disabled?: boolean | undefined
                enabled?: boolean | undefined
                codemode?: boolean | undefined
                timeout?:
                  | { startup?: number | undefined; catalog?: number | undefined; execution?: number | undefined }
                  | undefined
                oauth?: false | { client_id?: string | undefined; scope?: string | undefined } | undefined
              }
            }
          | undefined
        activation?: { [x: string]: "enabled" | "disabled" } | undefined
      }
    | undefined
  websearch?: false | ConfigWebSearchInfo | undefined
  code_interpreter?: { implementation: string & Brand.Brand<"CodeInterpreter.ID"> } | undefined
  gateway?:
    | {
        limits?: { rpm?: number | undefined; tpm?: number | undefined } | undefined
        models?: Array<string> | undefined
      }
    | undefined
  providers?:
    | {
        allow?: Array<string & Brand.Brand<"Provider.Name">> | undefined
        activation?: { [x: string]: "auto" | "enabled" | "disabled" } | undefined
      }
    | undefined
  routing?:
    | Array<
        | {
            match: {
              model?: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
              purpose?: Array<"assistant" | "generate" | "compaction" | "title">
              text?: { pattern: string; flags?: string }
              context?: { min?: number; max?: number }
              images?: boolean
              agent?: string
              tool?: string
            }
            to:
              | {
                  tiers: Array<{
                    name: string
                    model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
                    description: string
                  }>
                  default: string
                  judge: {
                    model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
                    instructions?: string
                    window?: number
                    timeout?: number
                  }
                }
              | { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
          }
        | {
            match: {
              model?: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
              purpose?: Array<"assistant" | "generate" | "compaction" | "title">
              text?: { pattern: string; flags?: string }
              context?: { min?: number; max?: number }
              images?: boolean
              agent?: string
              tool?: string
            }
            to:
              | {
                  tiers: Array<{
                    name: string
                    model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
                    description: string
                  }>
                  default: string
                  judge: {
                    model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
                    instructions?: string
                    window?: number
                    timeout?: number
                  }
                }
              | { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
          }
      >
    | undefined
  models?: Array<ModelCustom> | undefined
  model_policy: {
    disabled: Array<{ provider: string & Brand.Brand<"Provider.Name">; id: string }>
    seen: Array<{ provider: string & Brand.Brand<"Provider.Name">; id: string }>
    initialized: Array<string & Brand.Brand<"Provider.Name">>
  }
}

export type ApiConfigRefreshInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type ApiConfigRefreshOutput = {
  default_agent?: string & Brand.Brand<"Agent.ID">
  default_model?: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
  compaction: { auto: boolean; keep: { tokens: number }; buffer: number }
  permissions: PermissionRuleset
  plugins?: Array<string | ConfigPluginEntry> | undefined
  tool_output?: { max_lines: number; max_bytes: number } | undefined
  mcp?:
    | {
        servers?:
          | {
              [x: string]: {
                type: "remote"
                url: string
                headers?: { [x: string]: string } | undefined
                disabled?: boolean | undefined
                enabled?: boolean | undefined
                codemode?: boolean | undefined
                timeout?:
                  | { startup?: number | undefined; catalog?: number | undefined; execution?: number | undefined }
                  | undefined
                oauth?: false | { client_id?: string | undefined; scope?: string | undefined } | undefined
              }
            }
          | undefined
        activation?: { [x: string]: "enabled" | "disabled" } | undefined
      }
    | undefined
  websearch?: false | ConfigWebSearchInfo | undefined
  code_interpreter?: { implementation: string & Brand.Brand<"CodeInterpreter.ID"> } | undefined
  gateway?:
    | {
        limits?: { rpm?: number | undefined; tpm?: number | undefined } | undefined
        models?: Array<string> | undefined
      }
    | undefined
  providers?:
    | {
        allow?: Array<string & Brand.Brand<"Provider.Name">> | undefined
        activation?: { [x: string]: "auto" | "enabled" | "disabled" } | undefined
      }
    | undefined
  routing?:
    | Array<
        | {
            match: {
              model?: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
              purpose?: Array<"assistant" | "generate" | "compaction" | "title">
              text?: { pattern: string; flags?: string }
              context?: { min?: number; max?: number }
              images?: boolean
              agent?: string
              tool?: string
            }
            to:
              | {
                  tiers: Array<{
                    name: string
                    model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
                    description: string
                  }>
                  default: string
                  judge: {
                    model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
                    instructions?: string
                    window?: number
                    timeout?: number
                  }
                }
              | { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
          }
        | {
            match: {
              model?: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
              purpose?: Array<"assistant" | "generate" | "compaction" | "title">
              text?: { pattern: string; flags?: string }
              context?: { min?: number; max?: number }
              images?: boolean
              agent?: string
              tool?: string
            }
            to:
              | {
                  tiers: Array<{
                    name: string
                    model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
                    description: string
                  }>
                  default: string
                  judge: {
                    model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
                    instructions?: string
                    window?: number
                    timeout?: number
                  }
                }
              | { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
          }
      >
    | undefined
  models?: Array<ModelCustom> | undefined
  model_policy: {
    disabled: Array<{ provider: string & Brand.Brand<"Provider.Name">; id: string }>
    seen: Array<{ provider: string & Brand.Brand<"Provider.Name">; id: string }>
    initialized: Array<string & Brand.Brand<"Provider.Name">>
  }
}

export type ProjectCreateInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly name?: {
    readonly name?: string | undefined
    readonly icon?:
      | {
          readonly url?: globalThis.URL | undefined
          readonly override?: globalThis.URL | undefined
          readonly color?: string | undefined
        }
      | undefined
  }["name"]
  readonly icon?: {
    readonly name?: string | undefined
    readonly icon?:
      | {
          readonly url?: globalThis.URL | undefined
          readonly override?: globalThis.URL | undefined
          readonly color?: string | undefined
        }
      | undefined
  }["icon"]
}

export type ProjectCreateOutput = {
  id: string & Brand.Brand<"Project.ID">
  name?: string | undefined
  icon?:
    { url?: globalThis.URL | undefined; override?: globalThis.URL | undefined; color?: string | undefined } | undefined
  archivedAt?: globalThis.Date
  time_created: number
  time_updated: number
}

export type ProjectListInput = {
  readonly workspace?: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly archived?: boolean
  }["workspace"]
  readonly archived?: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly archived?: boolean
  }["archived"]
}

export type ProjectListOutput = Array<{
  id: string & Brand.Brand<"Project.ID">
  name?: string | undefined
  icon?:
    { url?: globalThis.URL | undefined; override?: globalThis.URL | undefined; color?: string | undefined } | undefined
  archivedAt?: globalThis.Date
  time_created: number
  time_updated: number
}>

export type ProjectGetInput = {
  readonly projectID: { readonly projectID: string & Brand.Brand<"Project.ID"> }["projectID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type ProjectGetOutput = {
  id: string & Brand.Brand<"Project.ID">
  name?: string | undefined
  icon?:
    { url?: globalThis.URL | undefined; override?: globalThis.URL | undefined; color?: string | undefined } | undefined
  archivedAt?: globalThis.Date
  time_created: number
  time_updated: number
}

export type ProjectUpdateInput = {
  readonly projectID: { readonly projectID: string & Brand.Brand<"Project.ID"> }["projectID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly name?: {
    readonly name?: string | null
    readonly icon?: {
      readonly url?: globalThis.URL | undefined
      readonly override?: globalThis.URL | undefined
      readonly color?: string | undefined
    } | null
    readonly archived?: boolean
  }["name"]
  readonly icon?: {
    readonly name?: string | null
    readonly icon?: {
      readonly url?: globalThis.URL | undefined
      readonly override?: globalThis.URL | undefined
      readonly color?: string | undefined
    } | null
    readonly archived?: boolean
  }["icon"]
  readonly archived?: {
    readonly name?: string | null
    readonly icon?: {
      readonly url?: globalThis.URL | undefined
      readonly override?: globalThis.URL | undefined
      readonly color?: string | undefined
    } | null
    readonly archived?: boolean
  }["archived"]
}

export type ProjectUpdateOutput = {
  id: string & Brand.Brand<"Project.ID">
  name?: string | undefined
  icon?:
    { url?: globalThis.URL | undefined; override?: globalThis.URL | undefined; color?: string | undefined } | undefined
  archivedAt?: globalThis.Date
  time_created: number
  time_updated: number
}

export type ProjectDeleteInput = {
  readonly projectID: { readonly projectID: string & Brand.Brand<"Project.ID"> }["projectID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type ProjectDeleteOutput = void

export type ProjectDirectoryListInput = {
  readonly projectID: { readonly projectID: string & Brand.Brand<"Project.ID"> }["projectID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type ProjectDirectoryListOutput = { paths: Array<string> }

export type ProjectDirectoryReadInput = {
  readonly projectID: { readonly projectID: string & Brand.Brand<"Project.ID"> }["projectID"]
  readonly path: { readonly path: string; readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["path"]
  readonly workspace?: { readonly path: string; readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type ProjectDirectoryReadOutput = globalThis.Uint8Array

export type ProjectDirectoryWriteInput = {
  readonly projectID: { readonly projectID: string & Brand.Brand<"Project.ID"> }["projectID"]
  readonly path: { readonly path: string; readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["path"]
  readonly workspace?: { readonly path: string; readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly contentType?: { readonly contentType?: string }["contentType"]
  readonly payload: globalThis.Uint8Array
}

export type ProjectDirectoryWriteOutput = void

export type ProjectDirectoryDeleteInput = {
  readonly projectID: { readonly projectID: string & Brand.Brand<"Project.ID"> }["projectID"]
  readonly path: { readonly path: string; readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["path"]
  readonly workspace?: { readonly path: string; readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type ProjectDirectoryDeleteOutput = void

export type ProjectDirectoryMoveInput = {
  readonly projectID: { readonly projectID: string & Brand.Brand<"Project.ID"> }["projectID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly from: { readonly from: string; readonly to: string }["from"]
  readonly to: { readonly from: string; readonly to: string }["to"]
}

export type ProjectDirectoryMoveOutput = void

export type ScheduledTaskCreateInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly name: {
    readonly name: string
    readonly prompt: string
    readonly cron: string
    readonly timezone: string
    readonly projectID?: string & Brand.Brand<"Project.ID">
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly enabled?: boolean
  }["name"]
  readonly prompt: {
    readonly name: string
    readonly prompt: string
    readonly cron: string
    readonly timezone: string
    readonly projectID?: string & Brand.Brand<"Project.ID">
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly enabled?: boolean
  }["prompt"]
  readonly cron: {
    readonly name: string
    readonly prompt: string
    readonly cron: string
    readonly timezone: string
    readonly projectID?: string & Brand.Brand<"Project.ID">
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly enabled?: boolean
  }["cron"]
  readonly timezone: {
    readonly name: string
    readonly prompt: string
    readonly cron: string
    readonly timezone: string
    readonly projectID?: string & Brand.Brand<"Project.ID">
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly enabled?: boolean
  }["timezone"]
  readonly projectID?: {
    readonly name: string
    readonly prompt: string
    readonly cron: string
    readonly timezone: string
    readonly projectID?: string & Brand.Brand<"Project.ID">
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly enabled?: boolean
  }["projectID"]
  readonly model?: {
    readonly name: string
    readonly prompt: string
    readonly cron: string
    readonly timezone: string
    readonly projectID?: string & Brand.Brand<"Project.ID">
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly enabled?: boolean
  }["model"]
  readonly enabled?: {
    readonly name: string
    readonly prompt: string
    readonly cron: string
    readonly timezone: string
    readonly projectID?: string & Brand.Brand<"Project.ID">
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly enabled?: boolean
  }["enabled"]
}

export type ScheduledTaskCreateOutput = ScheduledTaskInfo

export type ScheduledTaskListInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type ScheduledTaskListOutput = Array<ScheduledTaskInfo>

export type ScheduledTaskGetInput = {
  readonly taskID: { readonly taskID: string & Brand.Brand<"ScheduledTask.ID"> }["taskID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type ScheduledTaskGetOutput = ScheduledTaskInfo

export type ScheduledTaskUpdateInput = {
  readonly taskID: { readonly taskID: string & Brand.Brand<"ScheduledTask.ID"> }["taskID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly name?: {
    readonly name?: string
    readonly prompt?: string
    readonly cron?: string
    readonly timezone?: string
    readonly projectID?: string & Brand.Brand<"Project.ID">
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    } | null
    readonly enabled?: boolean
  }["name"]
  readonly prompt?: {
    readonly name?: string
    readonly prompt?: string
    readonly cron?: string
    readonly timezone?: string
    readonly projectID?: string & Brand.Brand<"Project.ID">
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    } | null
    readonly enabled?: boolean
  }["prompt"]
  readonly cron?: {
    readonly name?: string
    readonly prompt?: string
    readonly cron?: string
    readonly timezone?: string
    readonly projectID?: string & Brand.Brand<"Project.ID">
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    } | null
    readonly enabled?: boolean
  }["cron"]
  readonly timezone?: {
    readonly name?: string
    readonly prompt?: string
    readonly cron?: string
    readonly timezone?: string
    readonly projectID?: string & Brand.Brand<"Project.ID">
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    } | null
    readonly enabled?: boolean
  }["timezone"]
  readonly projectID?: {
    readonly name?: string
    readonly prompt?: string
    readonly cron?: string
    readonly timezone?: string
    readonly projectID?: string & Brand.Brand<"Project.ID">
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    } | null
    readonly enabled?: boolean
  }["projectID"]
  readonly model?: {
    readonly name?: string
    readonly prompt?: string
    readonly cron?: string
    readonly timezone?: string
    readonly projectID?: string & Brand.Brand<"Project.ID">
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    } | null
    readonly enabled?: boolean
  }["model"]
  readonly enabled?: {
    readonly name?: string
    readonly prompt?: string
    readonly cron?: string
    readonly timezone?: string
    readonly projectID?: string & Brand.Brand<"Project.ID">
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    } | null
    readonly enabled?: boolean
  }["enabled"]
}

export type ScheduledTaskUpdateOutput = ScheduledTaskInfo

export type ScheduledTaskDeleteInput = {
  readonly taskID: { readonly taskID: string & Brand.Brand<"ScheduledTask.ID"> }["taskID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type ScheduledTaskDeleteOutput = void

export type ScheduledTaskRunInput = {
  readonly taskID: { readonly taskID: string & Brand.Brand<"ScheduledTask.ID"> }["taskID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type ScheduledTaskRunOutput = SessionInfo

export type ScheduledTaskDismissInput = {
  readonly taskID: { readonly taskID: string & Brand.Brand<"ScheduledTask.ID"> }["taskID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type ScheduledTaskDismissOutput = ScheduledTaskInfo

export type SkillListInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type SkillListOutput = Array<{
  id: string & Brand.Brand<"Skill.ID">
  name: string
  description: string
  instructions: string
}>

export type SkillGetInput = {
  readonly skillID: { readonly skillID: string & Brand.Brand<"Skill.ID"> }["skillID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type SkillGetOutput = {
  id: string & Brand.Brand<"Skill.ID">
  name: string
  description: string
  instructions: string
}

export type SkillCreateInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly name: { readonly name: string; readonly description: string; readonly instructions: string }["name"]
  readonly description: {
    readonly name: string
    readonly description: string
    readonly instructions: string
  }["description"]
  readonly instructions: {
    readonly name: string
    readonly description: string
    readonly instructions: string
  }["instructions"]
}

export type SkillCreateOutput = {
  id: string & Brand.Brand<"Skill.ID">
  name: string
  description: string
  instructions: string
}

export type SkillUpdateInput = {
  readonly skillID: { readonly skillID: string & Brand.Brand<"Skill.ID"> }["skillID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly name: { readonly name: string; readonly description: string; readonly instructions: string }["name"]
  readonly description: {
    readonly name: string
    readonly description: string
    readonly instructions: string
  }["description"]
  readonly instructions: {
    readonly name: string
    readonly description: string
    readonly instructions: string
  }["instructions"]
}

export type SkillUpdateOutput = {
  id: string & Brand.Brand<"Skill.ID">
  name: string
  description: string
  instructions: string
}

export type SkillDeleteInput = {
  readonly skillID: { readonly skillID: string & Brand.Brand<"Skill.ID"> }["skillID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type SkillDeleteOutput = void

export type ApiPolicyListInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type ApiPolicyListOutput = Array<PolicyInfo>

export type ApiPolicyCreateInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly id: {
    readonly id: string
    readonly name: string
    readonly description?: string
    readonly enabled?: boolean
    readonly rules: ReadonlyArray<
      | { readonly type: "guardrail"; readonly action: string; readonly resource: string; readonly effect: "allow" }
      | {
          readonly type: "guardrail"
          readonly action: string
          readonly resource: string
          readonly effect: "deny"
          readonly message?: string
        }
      | {
          readonly type: "route"
          readonly action: "model.request" | "provider.request"
          readonly resource: string
          readonly target: string
        }
      | {
          readonly type: "endpoint"
          readonly model: string
          readonly baseURL?: string
          readonly headers?: { readonly [x: string]: string | { readonly env: string } }
        }
      | {
          readonly type: "escalate"
          readonly tool: string
          readonly target: string
          readonly purpose?: ReadonlyArray<"assistant" | "generate" | "compaction" | "title">
        }
      | {
          readonly type: "tool.input"
          readonly tool: string
          readonly path?: string
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly message?: string
        }
      | {
          readonly type: "tool.output"
          readonly tool: string
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly replacement: string
        }
      | { readonly type: "instruction"; readonly model: string; readonly agent?: string; readonly text: string }
      | {
          readonly type: "prompt"
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly replacement: string
        }
    >
  }["id"]
  readonly name: {
    readonly id: string
    readonly name: string
    readonly description?: string
    readonly enabled?: boolean
    readonly rules: ReadonlyArray<
      | { readonly type: "guardrail"; readonly action: string; readonly resource: string; readonly effect: "allow" }
      | {
          readonly type: "guardrail"
          readonly action: string
          readonly resource: string
          readonly effect: "deny"
          readonly message?: string
        }
      | {
          readonly type: "route"
          readonly action: "model.request" | "provider.request"
          readonly resource: string
          readonly target: string
        }
      | {
          readonly type: "endpoint"
          readonly model: string
          readonly baseURL?: string
          readonly headers?: { readonly [x: string]: string | { readonly env: string } }
        }
      | {
          readonly type: "escalate"
          readonly tool: string
          readonly target: string
          readonly purpose?: ReadonlyArray<"assistant" | "generate" | "compaction" | "title">
        }
      | {
          readonly type: "tool.input"
          readonly tool: string
          readonly path?: string
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly message?: string
        }
      | {
          readonly type: "tool.output"
          readonly tool: string
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly replacement: string
        }
      | { readonly type: "instruction"; readonly model: string; readonly agent?: string; readonly text: string }
      | {
          readonly type: "prompt"
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly replacement: string
        }
    >
  }["name"]
  readonly description?: {
    readonly id: string
    readonly name: string
    readonly description?: string
    readonly enabled?: boolean
    readonly rules: ReadonlyArray<
      | { readonly type: "guardrail"; readonly action: string; readonly resource: string; readonly effect: "allow" }
      | {
          readonly type: "guardrail"
          readonly action: string
          readonly resource: string
          readonly effect: "deny"
          readonly message?: string
        }
      | {
          readonly type: "route"
          readonly action: "model.request" | "provider.request"
          readonly resource: string
          readonly target: string
        }
      | {
          readonly type: "endpoint"
          readonly model: string
          readonly baseURL?: string
          readonly headers?: { readonly [x: string]: string | { readonly env: string } }
        }
      | {
          readonly type: "escalate"
          readonly tool: string
          readonly target: string
          readonly purpose?: ReadonlyArray<"assistant" | "generate" | "compaction" | "title">
        }
      | {
          readonly type: "tool.input"
          readonly tool: string
          readonly path?: string
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly message?: string
        }
      | {
          readonly type: "tool.output"
          readonly tool: string
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly replacement: string
        }
      | { readonly type: "instruction"; readonly model: string; readonly agent?: string; readonly text: string }
      | {
          readonly type: "prompt"
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly replacement: string
        }
    >
  }["description"]
  readonly enabled?: {
    readonly id: string
    readonly name: string
    readonly description?: string
    readonly enabled?: boolean
    readonly rules: ReadonlyArray<
      | { readonly type: "guardrail"; readonly action: string; readonly resource: string; readonly effect: "allow" }
      | {
          readonly type: "guardrail"
          readonly action: string
          readonly resource: string
          readonly effect: "deny"
          readonly message?: string
        }
      | {
          readonly type: "route"
          readonly action: "model.request" | "provider.request"
          readonly resource: string
          readonly target: string
        }
      | {
          readonly type: "endpoint"
          readonly model: string
          readonly baseURL?: string
          readonly headers?: { readonly [x: string]: string | { readonly env: string } }
        }
      | {
          readonly type: "escalate"
          readonly tool: string
          readonly target: string
          readonly purpose?: ReadonlyArray<"assistant" | "generate" | "compaction" | "title">
        }
      | {
          readonly type: "tool.input"
          readonly tool: string
          readonly path?: string
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly message?: string
        }
      | {
          readonly type: "tool.output"
          readonly tool: string
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly replacement: string
        }
      | { readonly type: "instruction"; readonly model: string; readonly agent?: string; readonly text: string }
      | {
          readonly type: "prompt"
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly replacement: string
        }
    >
  }["enabled"]
  readonly rules: {
    readonly id: string
    readonly name: string
    readonly description?: string
    readonly enabled?: boolean
    readonly rules: ReadonlyArray<
      | { readonly type: "guardrail"; readonly action: string; readonly resource: string; readonly effect: "allow" }
      | {
          readonly type: "guardrail"
          readonly action: string
          readonly resource: string
          readonly effect: "deny"
          readonly message?: string
        }
      | {
          readonly type: "route"
          readonly action: "model.request" | "provider.request"
          readonly resource: string
          readonly target: string
        }
      | {
          readonly type: "endpoint"
          readonly model: string
          readonly baseURL?: string
          readonly headers?: { readonly [x: string]: string | { readonly env: string } }
        }
      | {
          readonly type: "escalate"
          readonly tool: string
          readonly target: string
          readonly purpose?: ReadonlyArray<"assistant" | "generate" | "compaction" | "title">
        }
      | {
          readonly type: "tool.input"
          readonly tool: string
          readonly path?: string
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly message?: string
        }
      | {
          readonly type: "tool.output"
          readonly tool: string
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly replacement: string
        }
      | { readonly type: "instruction"; readonly model: string; readonly agent?: string; readonly text: string }
      | {
          readonly type: "prompt"
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly replacement: string
        }
    >
  }["rules"]
}

export type ApiPolicyCreateOutput = PolicyInfo

export type ApiPolicyUpdateInput = {
  readonly policyID: { readonly policyID: string }["policyID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly id: {
    readonly id: string
    readonly name: string
    readonly description?: string
    readonly enabled?: boolean
    readonly rules: ReadonlyArray<
      | { readonly type: "guardrail"; readonly action: string; readonly resource: string; readonly effect: "allow" }
      | {
          readonly type: "guardrail"
          readonly action: string
          readonly resource: string
          readonly effect: "deny"
          readonly message?: string
        }
      | {
          readonly type: "route"
          readonly action: "model.request" | "provider.request"
          readonly resource: string
          readonly target: string
        }
      | {
          readonly type: "endpoint"
          readonly model: string
          readonly baseURL?: string
          readonly headers?: { readonly [x: string]: string | { readonly env: string } }
        }
      | {
          readonly type: "escalate"
          readonly tool: string
          readonly target: string
          readonly purpose?: ReadonlyArray<"assistant" | "generate" | "compaction" | "title">
        }
      | {
          readonly type: "tool.input"
          readonly tool: string
          readonly path?: string
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly message?: string
        }
      | {
          readonly type: "tool.output"
          readonly tool: string
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly replacement: string
        }
      | { readonly type: "instruction"; readonly model: string; readonly agent?: string; readonly text: string }
      | {
          readonly type: "prompt"
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly replacement: string
        }
    >
  }["id"]
  readonly name: {
    readonly id: string
    readonly name: string
    readonly description?: string
    readonly enabled?: boolean
    readonly rules: ReadonlyArray<
      | { readonly type: "guardrail"; readonly action: string; readonly resource: string; readonly effect: "allow" }
      | {
          readonly type: "guardrail"
          readonly action: string
          readonly resource: string
          readonly effect: "deny"
          readonly message?: string
        }
      | {
          readonly type: "route"
          readonly action: "model.request" | "provider.request"
          readonly resource: string
          readonly target: string
        }
      | {
          readonly type: "endpoint"
          readonly model: string
          readonly baseURL?: string
          readonly headers?: { readonly [x: string]: string | { readonly env: string } }
        }
      | {
          readonly type: "escalate"
          readonly tool: string
          readonly target: string
          readonly purpose?: ReadonlyArray<"assistant" | "generate" | "compaction" | "title">
        }
      | {
          readonly type: "tool.input"
          readonly tool: string
          readonly path?: string
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly message?: string
        }
      | {
          readonly type: "tool.output"
          readonly tool: string
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly replacement: string
        }
      | { readonly type: "instruction"; readonly model: string; readonly agent?: string; readonly text: string }
      | {
          readonly type: "prompt"
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly replacement: string
        }
    >
  }["name"]
  readonly description?: {
    readonly id: string
    readonly name: string
    readonly description?: string
    readonly enabled?: boolean
    readonly rules: ReadonlyArray<
      | { readonly type: "guardrail"; readonly action: string; readonly resource: string; readonly effect: "allow" }
      | {
          readonly type: "guardrail"
          readonly action: string
          readonly resource: string
          readonly effect: "deny"
          readonly message?: string
        }
      | {
          readonly type: "route"
          readonly action: "model.request" | "provider.request"
          readonly resource: string
          readonly target: string
        }
      | {
          readonly type: "endpoint"
          readonly model: string
          readonly baseURL?: string
          readonly headers?: { readonly [x: string]: string | { readonly env: string } }
        }
      | {
          readonly type: "escalate"
          readonly tool: string
          readonly target: string
          readonly purpose?: ReadonlyArray<"assistant" | "generate" | "compaction" | "title">
        }
      | {
          readonly type: "tool.input"
          readonly tool: string
          readonly path?: string
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly message?: string
        }
      | {
          readonly type: "tool.output"
          readonly tool: string
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly replacement: string
        }
      | { readonly type: "instruction"; readonly model: string; readonly agent?: string; readonly text: string }
      | {
          readonly type: "prompt"
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly replacement: string
        }
    >
  }["description"]
  readonly enabled?: {
    readonly id: string
    readonly name: string
    readonly description?: string
    readonly enabled?: boolean
    readonly rules: ReadonlyArray<
      | { readonly type: "guardrail"; readonly action: string; readonly resource: string; readonly effect: "allow" }
      | {
          readonly type: "guardrail"
          readonly action: string
          readonly resource: string
          readonly effect: "deny"
          readonly message?: string
        }
      | {
          readonly type: "route"
          readonly action: "model.request" | "provider.request"
          readonly resource: string
          readonly target: string
        }
      | {
          readonly type: "endpoint"
          readonly model: string
          readonly baseURL?: string
          readonly headers?: { readonly [x: string]: string | { readonly env: string } }
        }
      | {
          readonly type: "escalate"
          readonly tool: string
          readonly target: string
          readonly purpose?: ReadonlyArray<"assistant" | "generate" | "compaction" | "title">
        }
      | {
          readonly type: "tool.input"
          readonly tool: string
          readonly path?: string
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly message?: string
        }
      | {
          readonly type: "tool.output"
          readonly tool: string
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly replacement: string
        }
      | { readonly type: "instruction"; readonly model: string; readonly agent?: string; readonly text: string }
      | {
          readonly type: "prompt"
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly replacement: string
        }
    >
  }["enabled"]
  readonly rules: {
    readonly id: string
    readonly name: string
    readonly description?: string
    readonly enabled?: boolean
    readonly rules: ReadonlyArray<
      | { readonly type: "guardrail"; readonly action: string; readonly resource: string; readonly effect: "allow" }
      | {
          readonly type: "guardrail"
          readonly action: string
          readonly resource: string
          readonly effect: "deny"
          readonly message?: string
        }
      | {
          readonly type: "route"
          readonly action: "model.request" | "provider.request"
          readonly resource: string
          readonly target: string
        }
      | {
          readonly type: "endpoint"
          readonly model: string
          readonly baseURL?: string
          readonly headers?: { readonly [x: string]: string | { readonly env: string } }
        }
      | {
          readonly type: "escalate"
          readonly tool: string
          readonly target: string
          readonly purpose?: ReadonlyArray<"assistant" | "generate" | "compaction" | "title">
        }
      | {
          readonly type: "tool.input"
          readonly tool: string
          readonly path?: string
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly message?: string
        }
      | {
          readonly type: "tool.output"
          readonly tool: string
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly replacement: string
        }
      | { readonly type: "instruction"; readonly model: string; readonly agent?: string; readonly text: string }
      | {
          readonly type: "prompt"
          readonly match: { readonly pattern: string; readonly flags?: string }
          readonly replacement: string
        }
    >
  }["rules"]
}

export type ApiPolicyUpdateOutput = PolicyInfo

export type ApiPolicyDeleteInput = {
  readonly policyID: { readonly policyID: string }["policyID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type ApiPolicyDeleteOutput = void

export type ApiPolicySetEnabledInput = {
  readonly policyID: { readonly policyID: string }["policyID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly enabled: { readonly enabled: boolean }["enabled"]
}

export type ApiPolicySetEnabledOutput = PolicyInfo

export type ApiPolicyValidateInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly payload: unknown
}

export type ApiPolicyValidateOutput = {
  valid: boolean
  issues: Array<{ path: Array<string | number>; message: string }>
}

export type ApiPolicySimulateInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly action: { readonly action: string; readonly resource: string }["action"]
  readonly resource: { readonly action: string; readonly resource: string }["resource"]
}

export type ApiPolicySimulateOutput = {
  guardrail: { effect: "allow" | "deny"; message?: string }
  route?: string
  trace: Array<PolicyTrace>
}

export type CommandListInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type CommandListOutput = Array<CommandInfo>

export type ReferenceListInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type ReferenceListOutput = Array<{
  name: string
  path: string
  description?: string
  hidden?: boolean
  source:
    | { type: "local"; path: string; description?: string; hidden?: boolean }
    | { type: "git"; repository: string; branch?: string; description?: string; hidden?: boolean }
}>

export type UsageListInput = {
  readonly workspace?: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly cursor?: string
    readonly limit?: number
  }["workspace"]
  readonly cursor?: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly cursor?: string
    readonly limit?: number
  }["cursor"]
  readonly limit?: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly cursor?: string
    readonly limit?: number
  }["limit"]
}

export type UsageListOutput = {
  data: Array<{
    id: string & Brand.Brand<"Message.ID">
    sessionID?: string & Brand.Brand<"Session.ID">
    model: { id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }
    createdAt: globalThis.Date
    usage: {
      cost: number
      costComplete: boolean
      tokens: {
        total?: number
        input: number
        output: number
        reasoning: number
        cache: { read: number; write: number }
      }
    }
    principal?:
      | { type: "user"; userID: string & Brand.Brand<"User.ID"> }
      | { type: "service_account"; serviceAccountID: string & Brand.Brand<"ServiceAccount.ID"> }
    source?: "session" | "inference"
    requestID?: string
    endpointID?: string
    upstreamModel?: string
  }>
  cursor?: string
}

export type UsageRecordsInput = {
  readonly workspace?: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly cursor?: string
    readonly limit?: number
  }["workspace"]
  readonly cursor?: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly cursor?: string
    readonly limit?: number
  }["cursor"]
  readonly limit?: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly cursor?: string
    readonly limit?: number
  }["limit"]
}

export type UsageRecordsOutput = {
  data: Array<{
    id: string & Brand.Brand<"Usage.ID">
    model: string
    createdAt: globalThis.Date
    usage: {
      cost: number
      costComplete: boolean
      tokens: {
        total?: number
        input: number
        output: number
        reasoning: number
        cache: { read: number; write: number }
      }
    }
    principal?:
      | { type: "user"; userID: string & Brand.Brand<"User.ID"> }
      | { type: "service_account"; serviceAccountID: string & Brand.Brand<"ServiceAccount.ID"> }
    source?: "session" | "inference"
    requestID?: string
    endpointID?: string
    upstreamModel?: string
  }>
  cursor?: string
}

export type UsageOverviewInput = {
  readonly workspace?: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly days: 7 | 30 | 90
  }["workspace"]
  readonly days: { readonly workspace?: string & Brand.Brand<"Workspace.ID">; readonly days: 7 | 30 | 90 }["days"]
}

export type UsageOverviewOutput = {
  days: number & Brand.Brand<"Usage.Days">
  from: globalThis.Date
  to: globalThis.Date
  total: {
    invocations: number
    cost: number
    costComplete: boolean
    tokens: { total: number; input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  }
  daily: Array<{
    date: string
    usage: {
      invocations: number
      cost: number
      costComplete: boolean
      tokens: {
        total: number
        input: number
        output: number
        reasoning: number
        cache: { read: number; write: number }
      }
    }
  }>
  users: Array<{
    userID: string & Brand.Brand<"User.ID">
    usage: {
      invocations: number
      cost: number
      costComplete: boolean
      tokens: {
        total: number
        input: number
        output: number
        reasoning: number
        cache: { read: number; write: number }
      }
    }
  }>
  models: Array<{
    model: string
    usage: {
      invocations: number
      cost: number
      costComplete: boolean
      tokens: {
        total: number
        input: number
        output: number
        reasoning: number
        cache: { read: number; write: number }
      }
    }
  }>
}

export type UsageLeaderboardInput = {
  readonly workspace?: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly days: 7 | 30 | 90
  }["workspace"]
  readonly days: { readonly workspace?: string & Brand.Brand<"Workspace.ID">; readonly days: 7 | 30 | 90 }["days"]
}

export type UsageLeaderboardOutput = {
  days: number & Brand.Brand<"Usage.Days">
  from: globalThis.Date
  to: globalThis.Date
  users: Array<{
    userID: string & Brand.Brand<"User.ID">
    email?: string & Brand.Brand<"Auth.Email">
    usage: {
      invocations: number
      cost: number
      costComplete: boolean
      tokens: {
        total: number
        input: number
        output: number
        reasoning: number
        cache: { read: number; write: number }
      }
    }
    models: Array<{
      model: string
      usage: {
        invocations: number
        cost: number
        costComplete: boolean
        tokens: {
          total: number
          input: number
          output: number
          reasoning: number
          cache: { read: number; write: number }
        }
      }
    }>
  }>
  models: Array<{
    model: string
    users: number
    usage: {
      invocations: number
      cost: number
      costComplete: boolean
      tokens: {
        total: number
        input: number
        output: number
        reasoning: number
        cache: { read: number; write: number }
      }
    }
  }>
}

export type ToolUsageListInput = {
  readonly workspace: {
    readonly workspace: string & Brand.Brand<"Workspace.ID">
    readonly cursor?: string
    readonly limit?: number
    readonly userID?: string & Brand.Brand<"User.ID">
    readonly sessionID?: string & Brand.Brand<"Session.ID">
  }["workspace"]
  readonly cursor?: {
    readonly workspace: string & Brand.Brand<"Workspace.ID">
    readonly cursor?: string
    readonly limit?: number
    readonly userID?: string & Brand.Brand<"User.ID">
    readonly sessionID?: string & Brand.Brand<"Session.ID">
  }["cursor"]
  readonly limit?: {
    readonly workspace: string & Brand.Brand<"Workspace.ID">
    readonly cursor?: string
    readonly limit?: number
    readonly userID?: string & Brand.Brand<"User.ID">
    readonly sessionID?: string & Brand.Brand<"Session.ID">
  }["limit"]
  readonly userID?: {
    readonly workspace: string & Brand.Brand<"Workspace.ID">
    readonly cursor?: string
    readonly limit?: number
    readonly userID?: string & Brand.Brand<"User.ID">
    readonly sessionID?: string & Brand.Brand<"Session.ID">
  }["userID"]
  readonly sessionID?: {
    readonly workspace: string & Brand.Brand<"Workspace.ID">
    readonly cursor?: string
    readonly limit?: number
    readonly userID?: string & Brand.Brand<"User.ID">
    readonly sessionID?: string & Brand.Brand<"Session.ID">
  }["sessionID"]
}

export type ToolUsageListOutput = ToolUsagePage

export type ModelListInput = {
  readonly workspace?: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly provider?: string
  }["workspace"]
  readonly provider?: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly provider?: string
  }["provider"]
}

export type ModelListOutput = Array<ModelManagement>

export type ModelAutoInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type ModelAutoOutput = Array<{ id: string; provider: string & Brand.Brand<"Provider.Name">; variant?: string }>

export type ModelRouteInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly model: {
    readonly model: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly prompt: string
    readonly purpose?: "assistant" | "generate" | "compaction" | "title"
  }["model"]
  readonly prompt: {
    readonly model: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly prompt: string
    readonly purpose?: "assistant" | "generate" | "compaction" | "title"
  }["prompt"]
  readonly purpose?: {
    readonly model: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly prompt: string
    readonly purpose?: "assistant" | "generate" | "compaction" | "title"
  }["purpose"]
}

export type ModelRouteOutput = ModelRoutePreview

export type ModelToggleInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly provider: {
    readonly provider: string & Brand.Brand<"Provider.Name">
    readonly id: string
    readonly enabled: boolean
  }["provider"]
  readonly id: {
    readonly provider: string & Brand.Brand<"Provider.Name">
    readonly id: string
    readonly enabled: boolean
  }["id"]
  readonly enabled: {
    readonly provider: string & Brand.Brand<"Provider.Name">
    readonly id: string
    readonly enabled: boolean
  }["enabled"]
}

export type ModelToggleOutput = Array<ModelManagement>

export type ModelDefaultInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly provider: { readonly provider: string & Brand.Brand<"Provider.Name">; readonly id: string }["provider"]
  readonly id: { readonly provider: string & Brand.Brand<"Provider.Name">; readonly id: string }["id"]
}

export type ModelDefaultOutput = Array<ModelManagement>

export type ModelCreateInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly provider: {
    readonly provider: string & Brand.Brand<"Provider.Name">
    readonly id?: string
    readonly name: string
    readonly apiID: string
    readonly cost?: { readonly input?: number; readonly output?: number }
    readonly limit?: { readonly context?: number }
  }["provider"]
  readonly id?: {
    readonly provider: string & Brand.Brand<"Provider.Name">
    readonly id?: string
    readonly name: string
    readonly apiID: string
    readonly cost?: { readonly input?: number; readonly output?: number }
    readonly limit?: { readonly context?: number }
  }["id"]
  readonly name: {
    readonly provider: string & Brand.Brand<"Provider.Name">
    readonly id?: string
    readonly name: string
    readonly apiID: string
    readonly cost?: { readonly input?: number; readonly output?: number }
    readonly limit?: { readonly context?: number }
  }["name"]
  readonly apiID: {
    readonly provider: string & Brand.Brand<"Provider.Name">
    readonly id?: string
    readonly name: string
    readonly apiID: string
    readonly cost?: { readonly input?: number; readonly output?: number }
    readonly limit?: { readonly context?: number }
  }["apiID"]
  readonly cost?: {
    readonly provider: string & Brand.Brand<"Provider.Name">
    readonly id?: string
    readonly name: string
    readonly apiID: string
    readonly cost?: { readonly input?: number; readonly output?: number }
    readonly limit?: { readonly context?: number }
  }["cost"]
  readonly limit?: {
    readonly provider: string & Brand.Brand<"Provider.Name">
    readonly id?: string
    readonly name: string
    readonly apiID: string
    readonly cost?: { readonly input?: number; readonly output?: number }
    readonly limit?: { readonly context?: number }
  }["limit"]
}

export type ModelCreateOutput = ModelManagement

export type ModelUpdateInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly provider: {
    readonly provider: string & Brand.Brand<"Provider.Name">
    readonly id: string
    readonly name: string
    readonly apiID: string
    readonly cost?: { readonly input?: number; readonly output?: number }
    readonly limit?: { readonly context?: number }
  }["provider"]
  readonly id: {
    readonly provider: string & Brand.Brand<"Provider.Name">
    readonly id: string
    readonly name: string
    readonly apiID: string
    readonly cost?: { readonly input?: number; readonly output?: number }
    readonly limit?: { readonly context?: number }
  }["id"]
  readonly name: {
    readonly provider: string & Brand.Brand<"Provider.Name">
    readonly id: string
    readonly name: string
    readonly apiID: string
    readonly cost?: { readonly input?: number; readonly output?: number }
    readonly limit?: { readonly context?: number }
  }["name"]
  readonly apiID: {
    readonly provider: string & Brand.Brand<"Provider.Name">
    readonly id: string
    readonly name: string
    readonly apiID: string
    readonly cost?: { readonly input?: number; readonly output?: number }
    readonly limit?: { readonly context?: number }
  }["apiID"]
  readonly cost?: {
    readonly provider: string & Brand.Brand<"Provider.Name">
    readonly id: string
    readonly name: string
    readonly apiID: string
    readonly cost?: { readonly input?: number; readonly output?: number }
    readonly limit?: { readonly context?: number }
  }["cost"]
  readonly limit?: {
    readonly provider: string & Brand.Brand<"Provider.Name">
    readonly id: string
    readonly name: string
    readonly apiID: string
    readonly cost?: { readonly input?: number; readonly output?: number }
    readonly limit?: { readonly context?: number }
  }["limit"]
}

export type ModelUpdateOutput = ModelManagement

export type ModelDeleteInput = {
  readonly workspace?: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly provider: string & Brand.Brand<"Provider.Name">
    readonly id: string
  }["workspace"]
  readonly provider: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly provider: string & Brand.Brand<"Provider.Name">
    readonly id: string
  }["provider"]
  readonly id: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly provider: string & Brand.Brand<"Provider.Name">
    readonly id: string
  }["id"]
}

export type ModelDeleteOutput = void

export type IntegrationListInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type IntegrationListOutput = Array<IntegrationInfo>

export type IntegrationGetInput = {
  readonly integrationID: { readonly integrationID: string & Brand.Brand<"Integration.ID"> }["integrationID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type IntegrationGetOutput = IntegrationInfo | undefined

export type IntegrationConnectKeyInput = {
  readonly integrationID: { readonly integrationID: string & Brand.Brand<"Integration.ID"> }["integrationID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly key: {
    readonly key: string
    readonly label?: string | undefined
    readonly scope?: ("member" | "workspace") | undefined
    readonly answer?: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> } | undefined
    readonly configuration?:
      { readonly type: "aws-region"; readonly region: string & Brand.Brand<"AwsRegion"> } | undefined
  }["key"]
  readonly label?: {
    readonly key: string
    readonly label?: string | undefined
    readonly scope?: ("member" | "workspace") | undefined
    readonly answer?: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> } | undefined
    readonly configuration?:
      { readonly type: "aws-region"; readonly region: string & Brand.Brand<"AwsRegion"> } | undefined
  }["label"]
  readonly scope?: {
    readonly key: string
    readonly label?: string | undefined
    readonly scope?: ("member" | "workspace") | undefined
    readonly answer?: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> } | undefined
    readonly configuration?:
      { readonly type: "aws-region"; readonly region: string & Brand.Brand<"AwsRegion"> } | undefined
  }["scope"]
  readonly answer?: {
    readonly key: string
    readonly label?: string | undefined
    readonly scope?: ("member" | "workspace") | undefined
    readonly answer?: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> } | undefined
    readonly configuration?:
      { readonly type: "aws-region"; readonly region: string & Brand.Brand<"AwsRegion"> } | undefined
  }["answer"]
  readonly configuration?: {
    readonly key: string
    readonly label?: string | undefined
    readonly scope?: ("member" | "workspace") | undefined
    readonly answer?: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> } | undefined
    readonly configuration?:
      { readonly type: "aws-region"; readonly region: string & Brand.Brand<"AwsRegion"> } | undefined
  }["configuration"]
}

export type IntegrationConnectKeyOutput = void

export type IntegrationConnectValuesInput = {
  readonly integrationID: { readonly integrationID: string & Brand.Brand<"Integration.ID"> }["integrationID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly values: { readonly values: { readonly [x: string]: string }; readonly label?: string | undefined }["values"]
  readonly label?: { readonly values: { readonly [x: string]: string }; readonly label?: string | undefined }["label"]
}

export type IntegrationConnectValuesOutput = void

export type IntegrationConnectAwsSigV4Input = {
  readonly integrationID: { readonly integrationID: string & Brand.Brand<"Integration.ID"> }["integrationID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly accessKeyId: {
    readonly accessKeyId: string
    readonly secretAccessKey: string
    readonly sessionToken?: string | undefined
    readonly region: string & Brand.Brand<"AwsRegion">
    readonly label?: string | undefined
    readonly scope?: ("member" | "workspace") | undefined
    readonly methodID?: (string & Brand.Brand<"Integration.MethodID">) | undefined
  }["accessKeyId"]
  readonly secretAccessKey: {
    readonly accessKeyId: string
    readonly secretAccessKey: string
    readonly sessionToken?: string | undefined
    readonly region: string & Brand.Brand<"AwsRegion">
    readonly label?: string | undefined
    readonly scope?: ("member" | "workspace") | undefined
    readonly methodID?: (string & Brand.Brand<"Integration.MethodID">) | undefined
  }["secretAccessKey"]
  readonly sessionToken?: {
    readonly accessKeyId: string
    readonly secretAccessKey: string
    readonly sessionToken?: string | undefined
    readonly region: string & Brand.Brand<"AwsRegion">
    readonly label?: string | undefined
    readonly scope?: ("member" | "workspace") | undefined
    readonly methodID?: (string & Brand.Brand<"Integration.MethodID">) | undefined
  }["sessionToken"]
  readonly region: {
    readonly accessKeyId: string
    readonly secretAccessKey: string
    readonly sessionToken?: string | undefined
    readonly region: string & Brand.Brand<"AwsRegion">
    readonly label?: string | undefined
    readonly scope?: ("member" | "workspace") | undefined
    readonly methodID?: (string & Brand.Brand<"Integration.MethodID">) | undefined
  }["region"]
  readonly label?: {
    readonly accessKeyId: string
    readonly secretAccessKey: string
    readonly sessionToken?: string | undefined
    readonly region: string & Brand.Brand<"AwsRegion">
    readonly label?: string | undefined
    readonly scope?: ("member" | "workspace") | undefined
    readonly methodID?: (string & Brand.Brand<"Integration.MethodID">) | undefined
  }["label"]
  readonly scope?: {
    readonly accessKeyId: string
    readonly secretAccessKey: string
    readonly sessionToken?: string | undefined
    readonly region: string & Brand.Brand<"AwsRegion">
    readonly label?: string | undefined
    readonly scope?: ("member" | "workspace") | undefined
    readonly methodID?: (string & Brand.Brand<"Integration.MethodID">) | undefined
  }["scope"]
  readonly methodID?: {
    readonly accessKeyId: string
    readonly secretAccessKey: string
    readonly sessionToken?: string | undefined
    readonly region: string & Brand.Brand<"AwsRegion">
    readonly label?: string | undefined
    readonly scope?: ("member" | "workspace") | undefined
    readonly methodID?: (string & Brand.Brand<"Integration.MethodID">) | undefined
  }["methodID"]
}

export type IntegrationConnectAwsSigV4Output = void

export type IntegrationOauthClientPutInput = {
  readonly integrationID: {
    readonly integrationID: string & Brand.Brand<"Integration.ID">
    readonly methodID: string & Brand.Brand<"Integration.MethodID">
  }["integrationID"]
  readonly methodID: {
    readonly integrationID: string & Brand.Brand<"Integration.ID">
    readonly methodID: string & Brand.Brand<"Integration.MethodID">
  }["methodID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly answer: {
    readonly answer: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> }
  }["answer"]
}

export type IntegrationOauthClientPutOutput = void

export type IntegrationOauthClientRemoveInput = {
  readonly integrationID: {
    readonly integrationID: string & Brand.Brand<"Integration.ID">
    readonly methodID: string & Brand.Brand<"Integration.MethodID">
  }["integrationID"]
  readonly methodID: {
    readonly integrationID: string & Brand.Brand<"Integration.ID">
    readonly methodID: string & Brand.Brand<"Integration.MethodID">
  }["methodID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type IntegrationOauthClientRemoveOutput = void

export type IntegrationOauthConnectInput = {
  readonly integrationID: { readonly integrationID: string & Brand.Brand<"Integration.ID"> }["integrationID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly methodID: {
    readonly methodID: string & Brand.Brand<"Integration.MethodID">
    readonly answer?: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> } | undefined
    readonly label?: string | undefined
    readonly scope?: ("member" | "workspace") | undefined
  }["methodID"]
  readonly answer?: {
    readonly methodID: string & Brand.Brand<"Integration.MethodID">
    readonly answer?: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> } | undefined
    readonly label?: string | undefined
    readonly scope?: ("member" | "workspace") | undefined
  }["answer"]
  readonly label?: {
    readonly methodID: string & Brand.Brand<"Integration.MethodID">
    readonly answer?: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> } | undefined
    readonly label?: string | undefined
    readonly scope?: ("member" | "workspace") | undefined
  }["label"]
  readonly scope?: {
    readonly methodID: string & Brand.Brand<"Integration.MethodID">
    readonly answer?: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> } | undefined
    readonly label?: string | undefined
    readonly scope?: ("member" | "workspace") | undefined
  }["scope"]
}

export type IntegrationOauthConnectOutput = IntegrationAttempt

export type IntegrationOauthStatusInput = {
  readonly integrationID: {
    readonly integrationID: string & Brand.Brand<"Integration.ID">
    readonly attemptID: string & Brand.Brand<"Integration.AttemptID">
  }["integrationID"]
  readonly attemptID: {
    readonly integrationID: string & Brand.Brand<"Integration.ID">
    readonly attemptID: string & Brand.Brand<"Integration.AttemptID">
  }["attemptID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type IntegrationOauthStatusOutput = IntegrationAttemptStatus

export type IntegrationOauthCompleteInput = {
  readonly integrationID: {
    readonly integrationID: string & Brand.Brand<"Integration.ID">
    readonly attemptID: string & Brand.Brand<"Integration.AttemptID">
  }["integrationID"]
  readonly attemptID: {
    readonly integrationID: string & Brand.Brand<"Integration.ID">
    readonly attemptID: string & Brand.Brand<"Integration.AttemptID">
  }["attemptID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly code?: { readonly code?: string | undefined }["code"]
}

export type IntegrationOauthCompleteOutput = void

export type IntegrationOauthCancelInput = {
  readonly integrationID: {
    readonly integrationID: string & Brand.Brand<"Integration.ID">
    readonly attemptID: string & Brand.Brand<"Integration.AttemptID">
  }["integrationID"]
  readonly attemptID: {
    readonly integrationID: string & Brand.Brand<"Integration.ID">
    readonly attemptID: string & Brand.Brand<"Integration.AttemptID">
  }["attemptID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type IntegrationOauthCancelOutput = void

export type IntegrationCommandConnectInput = {
  readonly integrationID: { readonly integrationID: string & Brand.Brand<"Integration.ID"> }["integrationID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly methodID: {
    readonly methodID: string & Brand.Brand<"Integration.MethodID">
    readonly label?: string | undefined
    readonly scope?: ("member" | "workspace") | undefined
  }["methodID"]
  readonly label?: {
    readonly methodID: string & Brand.Brand<"Integration.MethodID">
    readonly label?: string | undefined
    readonly scope?: ("member" | "workspace") | undefined
  }["label"]
  readonly scope?: {
    readonly methodID: string & Brand.Brand<"Integration.MethodID">
    readonly label?: string | undefined
    readonly scope?: ("member" | "workspace") | undefined
  }["scope"]
}

export type IntegrationCommandConnectOutput = IntegrationCommandAttempt

export type IntegrationCommandStatusInput = {
  readonly integrationID: {
    readonly integrationID: string & Brand.Brand<"Integration.ID">
    readonly attemptID: string & Brand.Brand<"Integration.AttemptID">
  }["integrationID"]
  readonly attemptID: {
    readonly integrationID: string & Brand.Brand<"Integration.ID">
    readonly attemptID: string & Brand.Brand<"Integration.AttemptID">
  }["attemptID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type IntegrationCommandStatusOutput = IntegrationCommandAttemptStatus

export type IntegrationCommandCancelInput = {
  readonly integrationID: {
    readonly integrationID: string & Brand.Brand<"Integration.ID">
    readonly attemptID: string & Brand.Brand<"Integration.AttemptID">
  }["integrationID"]
  readonly attemptID: {
    readonly integrationID: string & Brand.Brand<"Integration.ID">
    readonly attemptID: string & Brand.Brand<"Integration.AttemptID">
  }["attemptID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type IntegrationCommandCancelOutput = void

export type McpServersUpdateInput = {
  readonly server: { readonly server: string }["server"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly enabled: { readonly enabled: boolean }["enabled"]
}

export type McpServersUpdateOutput =
  | {
      name: string
      url?: string
      enabled: boolean
      auth?: "oauth" | "values"
      status: "connected"
      integrationID?: string
    }
  | {
      name: string
      url?: string
      enabled: boolean
      auth?: "oauth" | "values"
      status: "pending"
      integrationID?: string
    }
  | {
      name: string
      url?: string
      enabled: boolean
      auth?: "oauth" | "values"
      status: "disabled"
      integrationID?: string
    }
  | {
      name: string
      url?: string
      enabled: boolean
      auth?: "oauth" | "values"
      status: "failed"
      error: string
      integrationID?: string
    }
  | {
      name: string
      url?: string
      enabled: boolean
      auth?: "oauth" | "values"
      status: "needs_auth"
      integrationID: string
    }

export type McpToolsListInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type McpToolsListOutput = Array<{ server: string; name: string; action: string; description?: string }>

export type McpServersListInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type McpServersListOutput = Array<
  | {
      name: string
      url?: string
      enabled: boolean
      auth?: "oauth" | "values"
      status: "connected"
      integrationID?: string
    }
  | {
      name: string
      url?: string
      enabled: boolean
      auth?: "oauth" | "values"
      status: "pending"
      integrationID?: string
    }
  | {
      name: string
      url?: string
      enabled: boolean
      auth?: "oauth" | "values"
      status: "disabled"
      integrationID?: string
    }
  | {
      name: string
      url?: string
      enabled: boolean
      auth?: "oauth" | "values"
      status: "failed"
      error: string
      integrationID?: string
    }
  | {
      name: string
      url?: string
      enabled: boolean
      auth?: "oauth" | "values"
      status: "needs_auth"
      integrationID: string
    }
>

export type McpServersPutInput = {
  readonly server: { readonly server: string }["server"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly url: {
    readonly url: string
    readonly oauth?: false | { readonly client_id?: string; readonly scope?: string }
    readonly codemode?: boolean
    readonly disabled?: boolean
    readonly headers?: { readonly [x: string]: string }
  }["url"]
  readonly oauth?: {
    readonly url: string
    readonly oauth?: false | { readonly client_id?: string; readonly scope?: string }
    readonly codemode?: boolean
    readonly disabled?: boolean
    readonly headers?: { readonly [x: string]: string }
  }["oauth"]
  readonly codemode?: {
    readonly url: string
    readonly oauth?: false | { readonly client_id?: string; readonly scope?: string }
    readonly codemode?: boolean
    readonly disabled?: boolean
    readonly headers?: { readonly [x: string]: string }
  }["codemode"]
  readonly disabled?: {
    readonly url: string
    readonly oauth?: false | { readonly client_id?: string; readonly scope?: string }
    readonly codemode?: boolean
    readonly disabled?: boolean
    readonly headers?: { readonly [x: string]: string }
  }["disabled"]
  readonly headers?: {
    readonly url: string
    readonly oauth?: false | { readonly client_id?: string; readonly scope?: string }
    readonly codemode?: boolean
    readonly disabled?: boolean
    readonly headers?: { readonly [x: string]: string }
  }["headers"]
}

export type McpServersPutOutput = void

export type McpServersRemoveInput = {
  readonly server: { readonly server: string }["server"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type McpServersRemoveOutput = void

export type McpServersMembersInput = {
  readonly server: { readonly server: string }["server"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type McpServersMembersOutput = Array<{ userID: string; email: string; connected: boolean; updated?: string }>

export type McpServersConnectInput = {
  readonly server: { readonly server: string }["server"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly payload?: undefined | { readonly [x: string]: never }
}

export type McpServersConnectOutput = void

export type McpServersDisconnectInput = {
  readonly server: { readonly server: string }["server"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly payload?: undefined | { readonly [x: string]: never }
}

export type McpServersDisconnectOutput = void

export type McpServersTestInput = {
  readonly server: { readonly server: string }["server"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly payload?: undefined | { readonly [x: string]: never }
}

export type McpServersTestOutput = { ok: boolean; error?: string }

export type CredentialUpdateInput = {
  readonly credentialID: { readonly credentialID: string & Brand.Brand<"Credential.ID"> }["credentialID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly label: { readonly label: string }["label"]
}

export type CredentialUpdateOutput = void

export type CredentialActivateInput = {
  readonly credentialID: { readonly credentialID: string & Brand.Brand<"Credential.ID"> }["credentialID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type CredentialActivateOutput = void

export type CredentialRemoveInput = {
  readonly credentialID: { readonly credentialID: string & Brand.Brand<"Credential.ID"> }["credentialID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type CredentialRemoveOutput = void

export type WebsearchProvidersInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type WebsearchProvidersOutput = Array<WebSearchProvider>

export type WebsearchQueryInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly query: {
    readonly query: string
    readonly providerID?: (string & Brand.Brand<"WebSearch.ID">) | undefined
  }["query"]
  readonly providerID?: {
    readonly query: string
    readonly providerID?: (string & Brand.Brand<"WebSearch.ID">) | undefined
  }["providerID"]
}

export type WebsearchQueryOutput = WebSearchResponse

export type SessionCreateInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly projectID: {
    readonly projectID: string & Brand.Brand<"Project.ID">
    readonly agent?: string & Brand.Brand<"Agent.ID">
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
  }["projectID"]
  readonly agent?: {
    readonly projectID: string & Brand.Brand<"Project.ID">
    readonly agent?: string & Brand.Brand<"Agent.ID">
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
  }["agent"]
  readonly model?: {
    readonly projectID: string & Brand.Brand<"Project.ID">
    readonly agent?: string & Brand.Brand<"Agent.ID">
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
  }["model"]
}

export type SessionCreateOutput = SessionInfo

export type SessionListInput = {
  readonly cursor?: {
    readonly cursor?: string
    readonly limit?: number
    readonly search?: string
    readonly parentID?: (string & Brand.Brand<"Session.ID">) | null
    readonly archived?: boolean
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
  }["cursor"]
  readonly limit?: {
    readonly cursor?: string
    readonly limit?: number
    readonly search?: string
    readonly parentID?: (string & Brand.Brand<"Session.ID">) | null
    readonly archived?: boolean
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
  }["limit"]
  readonly search?: {
    readonly cursor?: string
    readonly limit?: number
    readonly search?: string
    readonly parentID?: (string & Brand.Brand<"Session.ID">) | null
    readonly archived?: boolean
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
  }["search"]
  readonly parentID?: {
    readonly cursor?: string
    readonly limit?: number
    readonly search?: string
    readonly parentID?: (string & Brand.Brand<"Session.ID">) | null
    readonly archived?: boolean
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
  }["parentID"]
  readonly archived?: {
    readonly cursor?: string
    readonly limit?: number
    readonly search?: string
    readonly parentID?: (string & Brand.Brand<"Session.ID">) | null
    readonly archived?: boolean
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
  }["archived"]
  readonly workspace?: {
    readonly cursor?: string
    readonly limit?: number
    readonly search?: string
    readonly parentID?: (string & Brand.Brand<"Session.ID">) | null
    readonly archived?: boolean
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
  }["workspace"]
}

export type SessionListOutput = SessionPage

export type SessionActiveInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type SessionActiveOutput = SessionActiveMap

export type SessionGetInput = {
  readonly sessionID: { readonly sessionID: string & Brand.Brand<"Session.ID"> }["sessionID"]
}

export type SessionGetOutput = SessionDetail

export type SessionUpdateInput = {
  readonly sessionID: { readonly sessionID: string & Brand.Brand<"Session.ID"> }["sessionID"]
  readonly title?: {
    readonly title?: string
    readonly projectID?: string & Brand.Brand<"Project.ID">
    readonly archived?: boolean
  }["title"]
  readonly projectID?: {
    readonly title?: string
    readonly projectID?: string & Brand.Brand<"Project.ID">
    readonly archived?: boolean
  }["projectID"]
  readonly archived?: {
    readonly title?: string
    readonly projectID?: string & Brand.Brand<"Project.ID">
    readonly archived?: boolean
  }["archived"]
}

export type SessionUpdateOutput = SessionInfo

export type SessionDeleteInput = {
  readonly sessionID: { readonly sessionID: string & Brand.Brand<"Session.ID"> }["sessionID"]
}

export type SessionDeleteOutput = void

export type SessionInboxListInput = {
  readonly sessionID: { readonly sessionID: string & Brand.Brand<"Session.ID"> }["sessionID"]
}

export type SessionInboxListOutput = { data: Array<SessionInboxInfo> }["data"]

export type SessionPromptInput = {
  readonly sessionID: { readonly sessionID: string & Brand.Brand<"Session.ID"> }["sessionID"]
  readonly id?: {
    readonly id?: string & Brand.Brand<"Message.ID">
    readonly text: string
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly metadata?: { readonly [x: string]: unknown }
    readonly delivery?: "steer" | "queue"
    readonly resume?: boolean
  }["id"]
  readonly text: {
    readonly id?: string & Brand.Brand<"Message.ID">
    readonly text: string
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly metadata?: { readonly [x: string]: unknown }
    readonly delivery?: "steer" | "queue"
    readonly resume?: boolean
  }["text"]
  readonly agents?: {
    readonly id?: string & Brand.Brand<"Message.ID">
    readonly text: string
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly metadata?: { readonly [x: string]: unknown }
    readonly delivery?: "steer" | "queue"
    readonly resume?: boolean
  }["agents"]
  readonly metadata?: {
    readonly id?: string & Brand.Brand<"Message.ID">
    readonly text: string
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly metadata?: { readonly [x: string]: unknown }
    readonly delivery?: "steer" | "queue"
    readonly resume?: boolean
  }["metadata"]
  readonly delivery?: {
    readonly id?: string & Brand.Brand<"Message.ID">
    readonly text: string
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly metadata?: { readonly [x: string]: unknown }
    readonly delivery?: "steer" | "queue"
    readonly resume?: boolean
  }["delivery"]
  readonly resume?: {
    readonly id?: string & Brand.Brand<"Message.ID">
    readonly text: string
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly metadata?: { readonly [x: string]: unknown }
    readonly delivery?: "steer" | "queue"
    readonly resume?: boolean
  }["resume"]
}

export type SessionPromptOutput = {
  id: string & Brand.Brand<"Message.ID">
  sessionID: string & Brand.Brand<"Session.ID">
  text: string
  agents?: Array<PromptAgentAttachment>
  metadata?: { [x: string]: any }
  delivery?: SessionInboxDelivery
  admittedSequence: number
  createdAt: globalThis.Date
}

export type SessionCompactInput = {
  readonly sessionID: { readonly sessionID: string & Brand.Brand<"Session.ID"> }["sessionID"]
  readonly id?: { readonly id?: string & Brand.Brand<"Message.ID"> }["id"]
}

export type SessionCompactOutput = {
  id: string & Brand.Brand<"Message.ID">
  sessionID: string & Brand.Brand<"Session.ID">
  text: string
  agents?: Array<PromptAgentAttachment>
  metadata?: { [x: string]: any }
  delivery?: SessionInboxDelivery
  admittedSequence: number
  createdAt: globalThis.Date
}

export type SessionInterruptInput = {
  readonly sessionID: { readonly sessionID: string & Brand.Brand<"Session.ID"> }["sessionID"]
  readonly payload?: undefined | { readonly [x: string]: never }
}

export type SessionInterruptOutput = void

export type SessionBackgroundInput = {
  readonly sessionID: { readonly sessionID: string & Brand.Brand<"Session.ID"> }["sessionID"]
}

export type SessionBackgroundOutput = void

export type SessionSwitchAgentInput = {
  readonly sessionID: { readonly sessionID: string & Brand.Brand<"Session.ID"> }["sessionID"]
  readonly agent: { readonly agent: string & Brand.Brand<"Agent.ID"> }["agent"]
}

export type SessionSwitchAgentOutput = void

export type SessionSwitchModelInput = {
  readonly sessionID: { readonly sessionID: string & Brand.Brand<"Session.ID"> }["sessionID"]
  readonly model: {
    readonly model: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
  }["model"]
}

export type SessionSwitchModelOutput = void

export type SessionRenameInput = {
  readonly sessionID: { readonly sessionID: string & Brand.Brand<"Session.ID"> }["sessionID"]
  readonly title: { readonly title: string }["title"]
}

export type SessionRenameOutput = void

export type SessionCommandInput = {
  readonly sessionID: { readonly sessionID: string & Brand.Brand<"Session.ID"> }["sessionID"]
  readonly id?: {
    readonly id?: string & Brand.Brand<"Message.ID">
    readonly command: string
    readonly arguments?: string
  }["id"]
  readonly command: {
    readonly id?: string & Brand.Brand<"Message.ID">
    readonly command: string
    readonly arguments?: string
  }["command"]
  readonly arguments?: {
    readonly id?: string & Brand.Brand<"Message.ID">
    readonly command: string
    readonly arguments?: string
  }["arguments"]
}

export type SessionCommandOutput = {
  id: string & Brand.Brand<"Message.ID">
  sessionID: string & Brand.Brand<"Session.ID">
  text: string
  agents?: Array<PromptAgentAttachment>
  metadata?: { [x: string]: any }
  delivery?: SessionInboxDelivery
  admittedSequence: number
  createdAt: globalThis.Date
}

export type SessionSyntheticInput = {
  readonly sessionID: { readonly sessionID: string & Brand.Brand<"Session.ID"> }["sessionID"]
  readonly id?: {
    readonly id?: string & Brand.Brand<"Message.ID">
    readonly text: string
    readonly description?: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: "steer" | "queue"
    readonly resume?: boolean
  }["id"]
  readonly text: {
    readonly id?: string & Brand.Brand<"Message.ID">
    readonly text: string
    readonly description?: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: "steer" | "queue"
    readonly resume?: boolean
  }["text"]
  readonly description?: {
    readonly id?: string & Brand.Brand<"Message.ID">
    readonly text: string
    readonly description?: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: "steer" | "queue"
    readonly resume?: boolean
  }["description"]
  readonly metadata?: {
    readonly id?: string & Brand.Brand<"Message.ID">
    readonly text: string
    readonly description?: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: "steer" | "queue"
    readonly resume?: boolean
  }["metadata"]
  readonly delivery?: {
    readonly id?: string & Brand.Brand<"Message.ID">
    readonly text: string
    readonly description?: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: "steer" | "queue"
    readonly resume?: boolean
  }["delivery"]
  readonly resume?: {
    readonly id?: string & Brand.Brand<"Message.ID">
    readonly text: string
    readonly description?: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: "steer" | "queue"
    readonly resume?: boolean
  }["resume"]
}

export type SessionSyntheticOutput = { data: SessionInboxSynthetic }["data"]

export type SessionWaitInput = {
  readonly sessionID: { readonly sessionID: string & Brand.Brand<"Session.ID"> }["sessionID"]
}

export type SessionWaitOutput = void

export type SessionGenerateInput = {
  readonly sessionID: { readonly sessionID: string & Brand.Brand<"Session.ID"> }["sessionID"]
  readonly prompt: { readonly prompt: string }["prompt"]
}

export type SessionGenerateOutput = { data: { text: string } }["data"]

export type SessionEntryListInput = {
  readonly sessionID: { readonly sessionID: string & Brand.Brand<"Session.ID"> }["sessionID"]
}

export type SessionEntryListOutput = InstructionEntryListResponse["data"]

export type SessionEntryPutInput = {
  readonly sessionID: { readonly sessionID: string & Brand.Brand<"Session.ID">; readonly key: string }["sessionID"]
  readonly key: { readonly sessionID: string & Brand.Brand<"Session.ID">; readonly key: string }["key"]
  readonly value: { readonly value: JsonValue }["value"]
}

export type SessionEntryPutOutput = void

export type SessionEntryRemoveInput = {
  readonly sessionID: { readonly sessionID: string & Brand.Brand<"Session.ID">; readonly key: string }["sessionID"]
  readonly key: { readonly sessionID: string & Brand.Brand<"Session.ID">; readonly key: string }["key"]
}

export type SessionEntryRemoveOutput = void

export type MessageListInput = {
  readonly sessionID: { readonly sessionID: string & Brand.Brand<"Session.ID"> }["sessionID"]
  readonly limit?: { readonly limit?: number; readonly order?: "asc" | "desc"; readonly cursor?: string }["limit"]
  readonly order?: { readonly limit?: number; readonly order?: "asc" | "desc"; readonly cursor?: string }["order"]
  readonly cursor?: { readonly limit?: number; readonly order?: "asc" | "desc"; readonly cursor?: string }["cursor"]
}

export type MessageListOutput = MessageListResponse

export type EventSubscribeInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type EventSubscribeOutput = WorkspaceEventItem

export type AgentListInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type AgentListOutput = Array<AgentInfo>

export type AgentGetInput = {
  readonly id: { readonly id: string & Brand.Brand<"Agent.ID"> }["id"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type AgentGetOutput = AgentInfo

export type AgentCreateInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly id: {
    readonly id: string & Brand.Brand<"Agent.ID">
    readonly name: string & Brand.Brand<"Agent.Name">
    readonly instructions: string
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string
    readonly steps: number | null
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: (string & Brand.Brand<"User.ID">) | undefined
    }>
    readonly overridden?: boolean
  }["id"]
  readonly name: {
    readonly id: string & Brand.Brand<"Agent.ID">
    readonly name: string & Brand.Brand<"Agent.Name">
    readonly instructions: string
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string
    readonly steps: number | null
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: (string & Brand.Brand<"User.ID">) | undefined
    }>
    readonly overridden?: boolean
  }["name"]
  readonly instructions: {
    readonly id: string & Brand.Brand<"Agent.ID">
    readonly name: string & Brand.Brand<"Agent.Name">
    readonly instructions: string
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string
    readonly steps: number | null
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: (string & Brand.Brand<"User.ID">) | undefined
    }>
    readonly overridden?: boolean
  }["instructions"]
  readonly model?: {
    readonly id: string & Brand.Brand<"Agent.ID">
    readonly name: string & Brand.Brand<"Agent.Name">
    readonly instructions: string
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string
    readonly steps: number | null
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: (string & Brand.Brand<"User.ID">) | undefined
    }>
    readonly overridden?: boolean
  }["model"]
  readonly description?: {
    readonly id: string & Brand.Brand<"Agent.ID">
    readonly name: string & Brand.Brand<"Agent.Name">
    readonly instructions: string
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string
    readonly steps: number | null
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: (string & Brand.Brand<"User.ID">) | undefined
    }>
    readonly overridden?: boolean
  }["description"]
  readonly mode: {
    readonly id: string & Brand.Brand<"Agent.ID">
    readonly name: string & Brand.Brand<"Agent.Name">
    readonly instructions: string
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string
    readonly steps: number | null
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: (string & Brand.Brand<"User.ID">) | undefined
    }>
    readonly overridden?: boolean
  }["mode"]
  readonly hidden: {
    readonly id: string & Brand.Brand<"Agent.ID">
    readonly name: string & Brand.Brand<"Agent.Name">
    readonly instructions: string
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string
    readonly steps: number | null
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: (string & Brand.Brand<"User.ID">) | undefined
    }>
    readonly overridden?: boolean
  }["hidden"]
  readonly color?: {
    readonly id: string & Brand.Brand<"Agent.ID">
    readonly name: string & Brand.Brand<"Agent.Name">
    readonly instructions: string
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string
    readonly steps: number | null
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: (string & Brand.Brand<"User.ID">) | undefined
    }>
    readonly overridden?: boolean
  }["color"]
  readonly steps: {
    readonly id: string & Brand.Brand<"Agent.ID">
    readonly name: string & Brand.Brand<"Agent.Name">
    readonly instructions: string
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string
    readonly steps: number | null
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: (string & Brand.Brand<"User.ID">) | undefined
    }>
    readonly overridden?: boolean
  }["steps"]
  readonly permissions: {
    readonly id: string & Brand.Brand<"Agent.ID">
    readonly name: string & Brand.Brand<"Agent.Name">
    readonly instructions: string
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string
    readonly steps: number | null
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: (string & Brand.Brand<"User.ID">) | undefined
    }>
    readonly overridden?: boolean
  }["permissions"]
  readonly overridden?: {
    readonly id: string & Brand.Brand<"Agent.ID">
    readonly name: string & Brand.Brand<"Agent.Name">
    readonly instructions: string
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string
    readonly steps: number | null
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: (string & Brand.Brand<"User.ID">) | undefined
    }>
    readonly overridden?: boolean
  }["overridden"]
}

export type AgentCreateOutput = AgentInfo

export type AgentUpdateInput = {
  readonly id: { readonly id: string & Brand.Brand<"Agent.ID"> }["id"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly name: {
    readonly name: string & Brand.Brand<"Agent.Name">
    readonly instructions: string
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string
    readonly steps: number | null
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: (string & Brand.Brand<"User.ID">) | undefined
    }>
  }["name"]
  readonly instructions: {
    readonly name: string & Brand.Brand<"Agent.Name">
    readonly instructions: string
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string
    readonly steps: number | null
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: (string & Brand.Brand<"User.ID">) | undefined
    }>
  }["instructions"]
  readonly model?: {
    readonly name: string & Brand.Brand<"Agent.Name">
    readonly instructions: string
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string
    readonly steps: number | null
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: (string & Brand.Brand<"User.ID">) | undefined
    }>
  }["model"]
  readonly description?: {
    readonly name: string & Brand.Brand<"Agent.Name">
    readonly instructions: string
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string
    readonly steps: number | null
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: (string & Brand.Brand<"User.ID">) | undefined
    }>
  }["description"]
  readonly mode: {
    readonly name: string & Brand.Brand<"Agent.Name">
    readonly instructions: string
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string
    readonly steps: number | null
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: (string & Brand.Brand<"User.ID">) | undefined
    }>
  }["mode"]
  readonly hidden: {
    readonly name: string & Brand.Brand<"Agent.Name">
    readonly instructions: string
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string
    readonly steps: number | null
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: (string & Brand.Brand<"User.ID">) | undefined
    }>
  }["hidden"]
  readonly color?: {
    readonly name: string & Brand.Brand<"Agent.Name">
    readonly instructions: string
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string
    readonly steps: number | null
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: (string & Brand.Brand<"User.ID">) | undefined
    }>
  }["color"]
  readonly steps: {
    readonly name: string & Brand.Brand<"Agent.Name">
    readonly instructions: string
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string
    readonly steps: number | null
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: (string & Brand.Brand<"User.ID">) | undefined
    }>
  }["steps"]
  readonly permissions: {
    readonly name: string & Brand.Brand<"Agent.Name">
    readonly instructions: string
    readonly model?: {
      readonly id: string
      readonly provider: string & Brand.Brand<"Provider.Name">
      readonly variant?: string
    }
    readonly description?: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden: boolean
    readonly color?: string
    readonly steps: number | null
    readonly permissions: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
      readonly user?: (string & Brand.Brand<"User.ID">) | undefined
    }>
  }["permissions"]
}

export type AgentUpdateOutput = AgentInfo

export type AgentDeleteInput = {
  readonly id: { readonly id: string & Brand.Brand<"Agent.ID"> }["id"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type AgentDeleteOutput = void

export type ApiAuditListInput = {
  readonly workspace?: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly from?: globalThis.Date
    readonly to?: globalThis.Date
    readonly actor?: string & Brand.Brand<"Account.ID">
    readonly action?:
      | "auth.login"
      | "auth.logout"
      | "auth.session.revoke"
      | "user.invite"
      | "user.accept"
      | "user.role.update"
      | "user.remove"
      | "account.suspend"
      | "account.restore"
      | "config.update"
      | "policy.write"
      | "permission.write"
      | "key.create"
      | "key.revoke"
      | "service-account.create"
      | "service-account.update"
      | "service-account.remove"
      | "auth-provider.create"
      | "auth-provider.update"
      | "license.activate"
      | "installation.admin.grant"
      | "installation.admin.revoke"
      | "installation.policy.update"
      | "setup.complete"
      | "session.delete"
      | "share.create"
      | "share.revoke"
      | "file.upload"
      | "file.delete"
      | "file.move"
      | "oauth.grant.create"
      | "oauth.grant.revoke"
      | "provider.update"
      | "model.create"
      | "model.update"
      | "model.delete"
      | "mcp.update"
      | "credential.connect"
      | "credential.update"
      | "credential.remove"
      | "budget.limit"
    readonly target?: string
    readonly cursor?: string
    readonly limit?: number
  }["workspace"]
  readonly from?: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly from?: globalThis.Date
    readonly to?: globalThis.Date
    readonly actor?: string & Brand.Brand<"Account.ID">
    readonly action?:
      | "auth.login"
      | "auth.logout"
      | "auth.session.revoke"
      | "user.invite"
      | "user.accept"
      | "user.role.update"
      | "user.remove"
      | "account.suspend"
      | "account.restore"
      | "config.update"
      | "policy.write"
      | "permission.write"
      | "key.create"
      | "key.revoke"
      | "service-account.create"
      | "service-account.update"
      | "service-account.remove"
      | "auth-provider.create"
      | "auth-provider.update"
      | "license.activate"
      | "installation.admin.grant"
      | "installation.admin.revoke"
      | "installation.policy.update"
      | "setup.complete"
      | "session.delete"
      | "share.create"
      | "share.revoke"
      | "file.upload"
      | "file.delete"
      | "file.move"
      | "oauth.grant.create"
      | "oauth.grant.revoke"
      | "provider.update"
      | "model.create"
      | "model.update"
      | "model.delete"
      | "mcp.update"
      | "credential.connect"
      | "credential.update"
      | "credential.remove"
      | "budget.limit"
    readonly target?: string
    readonly cursor?: string
    readonly limit?: number
  }["from"]
  readonly to?: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly from?: globalThis.Date
    readonly to?: globalThis.Date
    readonly actor?: string & Brand.Brand<"Account.ID">
    readonly action?:
      | "auth.login"
      | "auth.logout"
      | "auth.session.revoke"
      | "user.invite"
      | "user.accept"
      | "user.role.update"
      | "user.remove"
      | "account.suspend"
      | "account.restore"
      | "config.update"
      | "policy.write"
      | "permission.write"
      | "key.create"
      | "key.revoke"
      | "service-account.create"
      | "service-account.update"
      | "service-account.remove"
      | "auth-provider.create"
      | "auth-provider.update"
      | "license.activate"
      | "installation.admin.grant"
      | "installation.admin.revoke"
      | "installation.policy.update"
      | "setup.complete"
      | "session.delete"
      | "share.create"
      | "share.revoke"
      | "file.upload"
      | "file.delete"
      | "file.move"
      | "oauth.grant.create"
      | "oauth.grant.revoke"
      | "provider.update"
      | "model.create"
      | "model.update"
      | "model.delete"
      | "mcp.update"
      | "credential.connect"
      | "credential.update"
      | "credential.remove"
      | "budget.limit"
    readonly target?: string
    readonly cursor?: string
    readonly limit?: number
  }["to"]
  readonly actor?: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly from?: globalThis.Date
    readonly to?: globalThis.Date
    readonly actor?: string & Brand.Brand<"Account.ID">
    readonly action?:
      | "auth.login"
      | "auth.logout"
      | "auth.session.revoke"
      | "user.invite"
      | "user.accept"
      | "user.role.update"
      | "user.remove"
      | "account.suspend"
      | "account.restore"
      | "config.update"
      | "policy.write"
      | "permission.write"
      | "key.create"
      | "key.revoke"
      | "service-account.create"
      | "service-account.update"
      | "service-account.remove"
      | "auth-provider.create"
      | "auth-provider.update"
      | "license.activate"
      | "installation.admin.grant"
      | "installation.admin.revoke"
      | "installation.policy.update"
      | "setup.complete"
      | "session.delete"
      | "share.create"
      | "share.revoke"
      | "file.upload"
      | "file.delete"
      | "file.move"
      | "oauth.grant.create"
      | "oauth.grant.revoke"
      | "provider.update"
      | "model.create"
      | "model.update"
      | "model.delete"
      | "mcp.update"
      | "credential.connect"
      | "credential.update"
      | "credential.remove"
      | "budget.limit"
    readonly target?: string
    readonly cursor?: string
    readonly limit?: number
  }["actor"]
  readonly action?: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly from?: globalThis.Date
    readonly to?: globalThis.Date
    readonly actor?: string & Brand.Brand<"Account.ID">
    readonly action?:
      | "auth.login"
      | "auth.logout"
      | "auth.session.revoke"
      | "user.invite"
      | "user.accept"
      | "user.role.update"
      | "user.remove"
      | "account.suspend"
      | "account.restore"
      | "config.update"
      | "policy.write"
      | "permission.write"
      | "key.create"
      | "key.revoke"
      | "service-account.create"
      | "service-account.update"
      | "service-account.remove"
      | "auth-provider.create"
      | "auth-provider.update"
      | "license.activate"
      | "installation.admin.grant"
      | "installation.admin.revoke"
      | "installation.policy.update"
      | "setup.complete"
      | "session.delete"
      | "share.create"
      | "share.revoke"
      | "file.upload"
      | "file.delete"
      | "file.move"
      | "oauth.grant.create"
      | "oauth.grant.revoke"
      | "provider.update"
      | "model.create"
      | "model.update"
      | "model.delete"
      | "mcp.update"
      | "credential.connect"
      | "credential.update"
      | "credential.remove"
      | "budget.limit"
    readonly target?: string
    readonly cursor?: string
    readonly limit?: number
  }["action"]
  readonly target?: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly from?: globalThis.Date
    readonly to?: globalThis.Date
    readonly actor?: string & Brand.Brand<"Account.ID">
    readonly action?:
      | "auth.login"
      | "auth.logout"
      | "auth.session.revoke"
      | "user.invite"
      | "user.accept"
      | "user.role.update"
      | "user.remove"
      | "account.suspend"
      | "account.restore"
      | "config.update"
      | "policy.write"
      | "permission.write"
      | "key.create"
      | "key.revoke"
      | "service-account.create"
      | "service-account.update"
      | "service-account.remove"
      | "auth-provider.create"
      | "auth-provider.update"
      | "license.activate"
      | "installation.admin.grant"
      | "installation.admin.revoke"
      | "installation.policy.update"
      | "setup.complete"
      | "session.delete"
      | "share.create"
      | "share.revoke"
      | "file.upload"
      | "file.delete"
      | "file.move"
      | "oauth.grant.create"
      | "oauth.grant.revoke"
      | "provider.update"
      | "model.create"
      | "model.update"
      | "model.delete"
      | "mcp.update"
      | "credential.connect"
      | "credential.update"
      | "credential.remove"
      | "budget.limit"
    readonly target?: string
    readonly cursor?: string
    readonly limit?: number
  }["target"]
  readonly cursor?: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly from?: globalThis.Date
    readonly to?: globalThis.Date
    readonly actor?: string & Brand.Brand<"Account.ID">
    readonly action?:
      | "auth.login"
      | "auth.logout"
      | "auth.session.revoke"
      | "user.invite"
      | "user.accept"
      | "user.role.update"
      | "user.remove"
      | "account.suspend"
      | "account.restore"
      | "config.update"
      | "policy.write"
      | "permission.write"
      | "key.create"
      | "key.revoke"
      | "service-account.create"
      | "service-account.update"
      | "service-account.remove"
      | "auth-provider.create"
      | "auth-provider.update"
      | "license.activate"
      | "installation.admin.grant"
      | "installation.admin.revoke"
      | "installation.policy.update"
      | "setup.complete"
      | "session.delete"
      | "share.create"
      | "share.revoke"
      | "file.upload"
      | "file.delete"
      | "file.move"
      | "oauth.grant.create"
      | "oauth.grant.revoke"
      | "provider.update"
      | "model.create"
      | "model.update"
      | "model.delete"
      | "mcp.update"
      | "credential.connect"
      | "credential.update"
      | "credential.remove"
      | "budget.limit"
    readonly target?: string
    readonly cursor?: string
    readonly limit?: number
  }["cursor"]
  readonly limit?: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly from?: globalThis.Date
    readonly to?: globalThis.Date
    readonly actor?: string & Brand.Brand<"Account.ID">
    readonly action?:
      | "auth.login"
      | "auth.logout"
      | "auth.session.revoke"
      | "user.invite"
      | "user.accept"
      | "user.role.update"
      | "user.remove"
      | "account.suspend"
      | "account.restore"
      | "config.update"
      | "policy.write"
      | "permission.write"
      | "key.create"
      | "key.revoke"
      | "service-account.create"
      | "service-account.update"
      | "service-account.remove"
      | "auth-provider.create"
      | "auth-provider.update"
      | "license.activate"
      | "installation.admin.grant"
      | "installation.admin.revoke"
      | "installation.policy.update"
      | "setup.complete"
      | "session.delete"
      | "share.create"
      | "share.revoke"
      | "file.upload"
      | "file.delete"
      | "file.move"
      | "oauth.grant.create"
      | "oauth.grant.revoke"
      | "provider.update"
      | "model.create"
      | "model.update"
      | "model.delete"
      | "mcp.update"
      | "credential.connect"
      | "credential.update"
      | "credential.remove"
      | "budget.limit"
    readonly target?: string
    readonly cursor?: string
    readonly limit?: number
  }["limit"]
}

export type ApiAuditListOutput = {
  data: Array<{
    id: string & Brand.Brand<"Audit.ID">
    sequence: number
    occurredAt: globalThis.Date
    actor:
      | { type: "account"; accountID: string & Brand.Brand<"Account.ID"> }
      | {
          type: "user"
          accountID: string & Brand.Brand<"Account.ID">
          userID: string & Brand.Brand<"User.ID">
          workspaceID: string & Brand.Brand<"Workspace.ID">
        }
      | {
          type: "service_account"
          workspaceID: string & Brand.Brand<"Workspace.ID">
          serviceAccountID: string & Brand.Brand<"ServiceAccount.ID">
          keyID: string & Brand.Brand<"ApiKey.ID">
        }
      | { type: "system"; workspaceID?: (string & Brand.Brand<"Workspace.ID">) | undefined }
      | { type: "anonymous"; email?: string | undefined }
    action:
      | "auth.login"
      | "auth.logout"
      | "auth.session.revoke"
      | "user.invite"
      | "user.accept"
      | "user.role.update"
      | "user.remove"
      | "account.suspend"
      | "account.restore"
      | "config.update"
      | "policy.write"
      | "permission.write"
      | "key.create"
      | "key.revoke"
      | "service-account.create"
      | "service-account.update"
      | "service-account.remove"
      | "auth-provider.create"
      | "auth-provider.update"
      | "license.activate"
      | "installation.admin.grant"
      | "installation.admin.revoke"
      | "installation.policy.update"
      | "setup.complete"
      | "session.delete"
      | "share.create"
      | "share.revoke"
      | "file.upload"
      | "file.delete"
      | "file.move"
      | "oauth.grant.create"
      | "oauth.grant.revoke"
      | "provider.update"
      | "model.create"
      | "model.update"
      | "model.delete"
      | "mcp.update"
      | "credential.connect"
      | "credential.update"
      | "credential.remove"
      | "budget.limit"
    workspaceID?: (string & Brand.Brand<"Workspace.ID">) | undefined
    target?: string | undefined
    detail?: { [x: string]: any } | undefined
    outcome: "success" | "failure"
    context?: { ip?: string | undefined; userAgent?: string | undefined } | undefined
    chain: string
  }>
  cursor?: string
}

export type ServiceAccountListInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type ServiceAccountListOutput = Array<{
  id: string & Brand.Brand<"ServiceAccount.ID">
  workspaceID: string & Brand.Brand<"Workspace.ID">
  name: string
  status: "active" | "suspended"
  policy: { models?: Array<string> | undefined; rpm?: number | undefined; tpm?: number | undefined }
  timeCreated: globalThis.Date
  timeUpdated: globalThis.Date
  keyCount: number
}>

export type ServiceAccountCreateInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly name: {
    readonly name: string
    readonly policy?: {
      readonly models?: ReadonlyArray<string> | undefined
      readonly rpm?: number | undefined
      readonly tpm?: number | undefined
    }
  }["name"]
  readonly policy?: {
    readonly name: string
    readonly policy?: {
      readonly models?: ReadonlyArray<string> | undefined
      readonly rpm?: number | undefined
      readonly tpm?: number | undefined
    }
  }["policy"]
}

export type ServiceAccountCreateOutput = {
  id: string & Brand.Brand<"ServiceAccount.ID">
  workspaceID: string & Brand.Brand<"Workspace.ID">
  name: string
  status: "active" | "suspended"
  policy: { models?: Array<string> | undefined; rpm?: number | undefined; tpm?: number | undefined }
  timeCreated: globalThis.Date
  timeUpdated: globalThis.Date
}

export type ServiceAccountGetInput = {
  readonly id: { readonly id: string & Brand.Brand<"ServiceAccount.ID"> }["id"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type ServiceAccountGetOutput = {
  id: string & Brand.Brand<"ServiceAccount.ID">
  workspaceID: string & Brand.Brand<"Workspace.ID">
  name: string
  status: "active" | "suspended"
  policy: { models?: Array<string> | undefined; rpm?: number | undefined; tpm?: number | undefined }
  timeCreated: globalThis.Date
  timeUpdated: globalThis.Date
}

export type ServiceAccountUpdateInput = {
  readonly id: { readonly id: string & Brand.Brand<"ServiceAccount.ID"> }["id"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly name?: {
    readonly name?: string
    readonly policy?: {
      readonly models?: ReadonlyArray<string> | undefined
      readonly rpm?: number | undefined
      readonly tpm?: number | undefined
    }
    readonly status?: "active" | "suspended"
  }["name"]
  readonly policy?: {
    readonly name?: string
    readonly policy?: {
      readonly models?: ReadonlyArray<string> | undefined
      readonly rpm?: number | undefined
      readonly tpm?: number | undefined
    }
    readonly status?: "active" | "suspended"
  }["policy"]
  readonly status?: {
    readonly name?: string
    readonly policy?: {
      readonly models?: ReadonlyArray<string> | undefined
      readonly rpm?: number | undefined
      readonly tpm?: number | undefined
    }
    readonly status?: "active" | "suspended"
  }["status"]
}

export type ServiceAccountUpdateOutput = {
  id: string & Brand.Brand<"ServiceAccount.ID">
  workspaceID: string & Brand.Brand<"Workspace.ID">
  name: string
  status: "active" | "suspended"
  policy: { models?: Array<string> | undefined; rpm?: number | undefined; tpm?: number | undefined }
  timeCreated: globalThis.Date
  timeUpdated: globalThis.Date
}

export type ServiceAccountRemoveInput = {
  readonly id: { readonly id: string & Brand.Brand<"ServiceAccount.ID"> }["id"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type ServiceAccountRemoveOutput = void

export type ServiceAccountKeyListInput = {
  readonly id: { readonly id: string & Brand.Brand<"ServiceAccount.ID"> }["id"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type ServiceAccountKeyListOutput = Array<{
  id: string & Brand.Brand<"ApiKey.ID">
  workspaceID: string & Brand.Brand<"Workspace.ID">
  serviceAccountID: string & Brand.Brand<"ServiceAccount.ID">
  name: string
  prefix: string
  timeExpires?: globalThis.Date | undefined
  timeUsed?: globalThis.Date | undefined
  timeCreated: globalThis.Date
  timeRevoked?: globalThis.Date | undefined
}>

export type ServiceAccountKeyCreateInput = {
  readonly id: { readonly id: string & Brand.Brand<"ServiceAccount.ID"> }["id"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly name: { readonly name: string; readonly timeExpires?: globalThis.Date }["name"]
  readonly timeExpires?: { readonly name: string; readonly timeExpires?: globalThis.Date }["timeExpires"]
}

export type ServiceAccountKeyCreateOutput = {
  key: {
    id: string & Brand.Brand<"ApiKey.ID">
    workspaceID: string & Brand.Brand<"Workspace.ID">
    serviceAccountID: string & Brand.Brand<"ServiceAccount.ID">
    name: string
    prefix: string
    timeExpires?: globalThis.Date | undefined
    timeUsed?: globalThis.Date | undefined
    timeCreated: globalThis.Date
    timeRevoked?: globalThis.Date | undefined
  }
  secret: string & Brand.Brand<"ApiKey.Secret">
}

export type ServiceAccountKeyRevokeInput = {
  readonly id: {
    readonly id: string & Brand.Brand<"ServiceAccount.ID">
    readonly keyID: string & Brand.Brand<"ApiKey.ID">
  }["id"]
  readonly keyID: {
    readonly id: string & Brand.Brand<"ServiceAccount.ID">
    readonly keyID: string & Brand.Brand<"ApiKey.ID">
  }["keyID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type ServiceAccountKeyRevokeOutput = void

export type BudgetStatusInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type BudgetStatusOutput = {
  period: { start: globalThis.Date; end: globalThis.Date }
  standings: Array<{
    target:
      | { type: "workspace" }
      | { type: "user"; userID: string & Brand.Brand<"User.ID"> }
      | { type: "service_account"; serviceAccountID: string & Brand.Brand<"ServiceAccount.ID"> }
    holder: string & Brand.Brand<"Budget.Holder">
    period: { start: globalThis.Date; end: globalThis.Date }
    spent: number
    limit?: number
  }>
}

export type BudgetLimitInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly target: {
    readonly target:
      | { readonly type: "workspace" }
      | { readonly type: "user"; readonly userID: string & Brand.Brand<"User.ID"> }
      | { readonly type: "service_account"; readonly serviceAccountID: string & Brand.Brand<"ServiceAccount.ID"> }
    readonly amount?: number
  }["target"]
  readonly amount?: {
    readonly target:
      | { readonly type: "workspace" }
      | { readonly type: "user"; readonly userID: string & Brand.Brand<"User.ID"> }
      | { readonly type: "service_account"; readonly serviceAccountID: string & Brand.Brand<"ServiceAccount.ID"> }
    readonly amount?: number
  }["amount"]
}

export type BudgetLimitOutput = {
  target:
    | { type: "workspace" }
    | { type: "user"; userID: string & Brand.Brand<"User.ID"> }
    | { type: "service_account"; serviceAccountID: string & Brand.Brand<"ServiceAccount.ID"> }
  holder: string & Brand.Brand<"Budget.Holder">
  period: { start: globalThis.Date; end: globalThis.Date }
  spent: number
  limit?: number
}

export type PermissionRequestListInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type PermissionRequestListOutput = Array<PermissionRequest>

export type PermissionSavedListInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type PermissionSavedListOutput = Array<{
  id: string & Brand.Brand<"Permission.SavedID">
  action: string
  resource: string
}>

export type PermissionSavedRemoveInput = {
  readonly savedID: { readonly savedID: string & Brand.Brand<"Permission.SavedID"> }["savedID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type PermissionSavedRemoveOutput = void

export type PermissionToolsListInput = {
  readonly workspace?: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly user?: string & Brand.Brand<"User.ID">
  }["workspace"]
  readonly user?: {
    readonly workspace?: string & Brand.Brand<"Workspace.ID">
    readonly user?: string & Brand.Brand<"User.ID">
  }["user"]
}

export type PermissionToolsListOutput = Array<{
  name: string
  action: string
  description: string
  effect: PermissionEffect
}>

export type PermissionToolsUpdateInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly user?: {
    readonly user?: string & Brand.Brand<"User.ID">
    readonly tools: ReadonlyArray<{ readonly action: string; readonly effect: "allow" | "deny" | "ask" }>
  }["user"]
  readonly tools: {
    readonly user?: string & Brand.Brand<"User.ID">
    readonly tools: ReadonlyArray<{ readonly action: string; readonly effect: "allow" | "deny" | "ask" }>
  }["tools"]
}

export type PermissionToolsUpdateOutput = Array<{
  name: string
  action: string
  description: string
  effect: PermissionEffect
}>

export type PermissionCreateInput = {
  readonly sessionID: { readonly sessionID: string & Brand.Brand<"Session.ID"> }["sessionID"]
  readonly id?: {
    readonly id?: (string & Brand.Brand<"Permission.ID">) | undefined
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string> | undefined
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?:
      | { readonly type: "tool"; readonly messageID: string & Brand.Brand<"Message.ID">; readonly callID: string }
      | undefined
    readonly agent?: (string & Brand.Brand<"Agent.ID">) | undefined
  }["id"]
  readonly action: {
    readonly id?: (string & Brand.Brand<"Permission.ID">) | undefined
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string> | undefined
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?:
      | { readonly type: "tool"; readonly messageID: string & Brand.Brand<"Message.ID">; readonly callID: string }
      | undefined
    readonly agent?: (string & Brand.Brand<"Agent.ID">) | undefined
  }["action"]
  readonly resources: {
    readonly id?: (string & Brand.Brand<"Permission.ID">) | undefined
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string> | undefined
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?:
      | { readonly type: "tool"; readonly messageID: string & Brand.Brand<"Message.ID">; readonly callID: string }
      | undefined
    readonly agent?: (string & Brand.Brand<"Agent.ID">) | undefined
  }["resources"]
  readonly save?: {
    readonly id?: (string & Brand.Brand<"Permission.ID">) | undefined
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string> | undefined
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?:
      | { readonly type: "tool"; readonly messageID: string & Brand.Brand<"Message.ID">; readonly callID: string }
      | undefined
    readonly agent?: (string & Brand.Brand<"Agent.ID">) | undefined
  }["save"]
  readonly metadata?: {
    readonly id?: (string & Brand.Brand<"Permission.ID">) | undefined
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string> | undefined
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?:
      | { readonly type: "tool"; readonly messageID: string & Brand.Brand<"Message.ID">; readonly callID: string }
      | undefined
    readonly agent?: (string & Brand.Brand<"Agent.ID">) | undefined
  }["metadata"]
  readonly source?: {
    readonly id?: (string & Brand.Brand<"Permission.ID">) | undefined
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string> | undefined
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?:
      | { readonly type: "tool"; readonly messageID: string & Brand.Brand<"Message.ID">; readonly callID: string }
      | undefined
    readonly agent?: (string & Brand.Brand<"Agent.ID">) | undefined
  }["source"]
  readonly agent?: {
    readonly id?: (string & Brand.Brand<"Permission.ID">) | undefined
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string> | undefined
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?:
      | { readonly type: "tool"; readonly messageID: string & Brand.Brand<"Message.ID">; readonly callID: string }
      | undefined
    readonly agent?: (string & Brand.Brand<"Agent.ID">) | undefined
  }["agent"]
}

export type PermissionCreateOutput = { id: string & Brand.Brand<"Permission.ID">; effect: PermissionEffect }

export type PermissionListInput = {
  readonly sessionID: { readonly sessionID: string & Brand.Brand<"Session.ID"> }["sessionID"]
}

export type PermissionListOutput = Array<PermissionRequest>

export type PermissionGetInput = {
  readonly sessionID: {
    readonly sessionID: string & Brand.Brand<"Session.ID">
    readonly requestID: string & Brand.Brand<"Permission.ID">
  }["sessionID"]
  readonly requestID: {
    readonly sessionID: string & Brand.Brand<"Session.ID">
    readonly requestID: string & Brand.Brand<"Permission.ID">
  }["requestID"]
}

export type PermissionGetOutput = PermissionRequest

export type PermissionReplyInput = {
  readonly sessionID: {
    readonly sessionID: string & Brand.Brand<"Session.ID">
    readonly requestID: string & Brand.Brand<"Permission.ID">
  }["sessionID"]
  readonly requestID: {
    readonly sessionID: string & Brand.Brand<"Session.ID">
    readonly requestID: string & Brand.Brand<"Permission.ID">
  }["requestID"]
  readonly reply: { readonly reply: "once" | "always" | "reject"; readonly message?: string | undefined }["reply"]
  readonly message?: { readonly reply: "once" | "always" | "reject"; readonly message?: string | undefined }["message"]
}

export type PermissionReplyOutput = void

export type FormRequestListInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type FormRequestListOutput = Array<FormInfo>

export type FormCallerListInput = {
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type FormCallerListOutput = Array<FormInfo>

export type FormCallerGetInput = {
  readonly formID: { readonly formID: string & Brand.Brand<"Form.ID"> }["formID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type FormCallerGetOutput = FormInfo

export type FormCallerStateInput = {
  readonly formID: { readonly formID: string & Brand.Brand<"Form.ID"> }["formID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type FormCallerStateOutput = FormState

export type FormCallerReplyInput = {
  readonly formID: { readonly formID: string & Brand.Brand<"Form.ID"> }["formID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
  readonly answer: {
    readonly answer: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> }
  }["answer"]
}

export type FormCallerReplyOutput = void

export type FormCallerCancelInput = {
  readonly formID: { readonly formID: string & Brand.Brand<"Form.ID"> }["formID"]
  readonly workspace?: { readonly workspace?: string & Brand.Brand<"Workspace.ID"> }["workspace"]
}

export type FormCallerCancelOutput = void

export type FormListInput = {
  readonly sessionID: { readonly sessionID: string & Brand.Brand<"Session.ID"> }["sessionID"]
}

export type FormListOutput = Array<FormInfo>

export type FormCreateInput = {
  readonly sessionID: { readonly sessionID: string & Brand.Brand<"Session.ID"> }["sessionID"]
  readonly id?: {
    readonly id?: string & Brand.Brand<"Form.ID">
    readonly title: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly fields: readonly [
      (
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "string"
            readonly secret?: boolean | undefined
            readonly multiline?: boolean | undefined
            readonly format?: "email" | "uri" | "date" | "date-time" | undefined
            readonly minLength?: number | undefined
            readonly maxLength?: number | undefined
            readonly pattern?: string | undefined
            readonly placeholder?: string | undefined
            readonly default?: string | undefined
            readonly options?:
              | ReadonlyArray<{
                  readonly value: string
                  readonly label: string
                  readonly description?: string | undefined
                }>
              | undefined
            readonly custom?: boolean | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "number"
            readonly minimum?: number | undefined
            readonly maximum?: number | undefined
            readonly default?: number | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "integer"
            readonly minimum?: number | undefined
            readonly maximum?: number | undefined
            readonly default?: number | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "boolean"
            readonly default?: boolean | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "multiselect"
            readonly options: ReadonlyArray<{
              readonly value: string
              readonly label: string
              readonly description?: string | undefined
            }>
            readonly minItems?: number | undefined
            readonly maxItems?: number | undefined
            readonly custom?: boolean | undefined
            readonly default?: ReadonlyArray<string> | undefined
          }
        | {
            readonly key: string
            readonly type: "external"
            readonly url: string
            readonly title?: string | undefined
            readonly description?: string | undefined
          }
      ),
      ...Array<
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "string"
            readonly secret?: boolean | undefined
            readonly multiline?: boolean | undefined
            readonly format?: "email" | "uri" | "date" | "date-time" | undefined
            readonly minLength?: number | undefined
            readonly maxLength?: number | undefined
            readonly pattern?: string | undefined
            readonly placeholder?: string | undefined
            readonly default?: string | undefined
            readonly options?:
              | ReadonlyArray<{
                  readonly value: string
                  readonly label: string
                  readonly description?: string | undefined
                }>
              | undefined
            readonly custom?: boolean | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "number"
            readonly minimum?: number | undefined
            readonly maximum?: number | undefined
            readonly default?: number | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "integer"
            readonly minimum?: number | undefined
            readonly maximum?: number | undefined
            readonly default?: number | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "boolean"
            readonly default?: boolean | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "multiselect"
            readonly options: ReadonlyArray<{
              readonly value: string
              readonly label: string
              readonly description?: string | undefined
            }>
            readonly minItems?: number | undefined
            readonly maxItems?: number | undefined
            readonly custom?: boolean | undefined
            readonly default?: ReadonlyArray<string> | undefined
          }
        | {
            readonly key: string
            readonly type: "external"
            readonly url: string
            readonly title?: string | undefined
            readonly description?: string | undefined
          }
      >,
    ]
  }["id"]
  readonly title: {
    readonly id?: string & Brand.Brand<"Form.ID">
    readonly title: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly fields: readonly [
      (
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "string"
            readonly secret?: boolean | undefined
            readonly multiline?: boolean | undefined
            readonly format?: "email" | "uri" | "date" | "date-time" | undefined
            readonly minLength?: number | undefined
            readonly maxLength?: number | undefined
            readonly pattern?: string | undefined
            readonly placeholder?: string | undefined
            readonly default?: string | undefined
            readonly options?:
              | ReadonlyArray<{
                  readonly value: string
                  readonly label: string
                  readonly description?: string | undefined
                }>
              | undefined
            readonly custom?: boolean | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "number"
            readonly minimum?: number | undefined
            readonly maximum?: number | undefined
            readonly default?: number | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "integer"
            readonly minimum?: number | undefined
            readonly maximum?: number | undefined
            readonly default?: number | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "boolean"
            readonly default?: boolean | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "multiselect"
            readonly options: ReadonlyArray<{
              readonly value: string
              readonly label: string
              readonly description?: string | undefined
            }>
            readonly minItems?: number | undefined
            readonly maxItems?: number | undefined
            readonly custom?: boolean | undefined
            readonly default?: ReadonlyArray<string> | undefined
          }
        | {
            readonly key: string
            readonly type: "external"
            readonly url: string
            readonly title?: string | undefined
            readonly description?: string | undefined
          }
      ),
      ...Array<
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "string"
            readonly secret?: boolean | undefined
            readonly multiline?: boolean | undefined
            readonly format?: "email" | "uri" | "date" | "date-time" | undefined
            readonly minLength?: number | undefined
            readonly maxLength?: number | undefined
            readonly pattern?: string | undefined
            readonly placeholder?: string | undefined
            readonly default?: string | undefined
            readonly options?:
              | ReadonlyArray<{
                  readonly value: string
                  readonly label: string
                  readonly description?: string | undefined
                }>
              | undefined
            readonly custom?: boolean | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "number"
            readonly minimum?: number | undefined
            readonly maximum?: number | undefined
            readonly default?: number | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "integer"
            readonly minimum?: number | undefined
            readonly maximum?: number | undefined
            readonly default?: number | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "boolean"
            readonly default?: boolean | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "multiselect"
            readonly options: ReadonlyArray<{
              readonly value: string
              readonly label: string
              readonly description?: string | undefined
            }>
            readonly minItems?: number | undefined
            readonly maxItems?: number | undefined
            readonly custom?: boolean | undefined
            readonly default?: ReadonlyArray<string> | undefined
          }
        | {
            readonly key: string
            readonly type: "external"
            readonly url: string
            readonly title?: string | undefined
            readonly description?: string | undefined
          }
      >,
    ]
  }["title"]
  readonly metadata?: {
    readonly id?: string & Brand.Brand<"Form.ID">
    readonly title: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly fields: readonly [
      (
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "string"
            readonly secret?: boolean | undefined
            readonly multiline?: boolean | undefined
            readonly format?: "email" | "uri" | "date" | "date-time" | undefined
            readonly minLength?: number | undefined
            readonly maxLength?: number | undefined
            readonly pattern?: string | undefined
            readonly placeholder?: string | undefined
            readonly default?: string | undefined
            readonly options?:
              | ReadonlyArray<{
                  readonly value: string
                  readonly label: string
                  readonly description?: string | undefined
                }>
              | undefined
            readonly custom?: boolean | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "number"
            readonly minimum?: number | undefined
            readonly maximum?: number | undefined
            readonly default?: number | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "integer"
            readonly minimum?: number | undefined
            readonly maximum?: number | undefined
            readonly default?: number | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "boolean"
            readonly default?: boolean | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "multiselect"
            readonly options: ReadonlyArray<{
              readonly value: string
              readonly label: string
              readonly description?: string | undefined
            }>
            readonly minItems?: number | undefined
            readonly maxItems?: number | undefined
            readonly custom?: boolean | undefined
            readonly default?: ReadonlyArray<string> | undefined
          }
        | {
            readonly key: string
            readonly type: "external"
            readonly url: string
            readonly title?: string | undefined
            readonly description?: string | undefined
          }
      ),
      ...Array<
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "string"
            readonly secret?: boolean | undefined
            readonly multiline?: boolean | undefined
            readonly format?: "email" | "uri" | "date" | "date-time" | undefined
            readonly minLength?: number | undefined
            readonly maxLength?: number | undefined
            readonly pattern?: string | undefined
            readonly placeholder?: string | undefined
            readonly default?: string | undefined
            readonly options?:
              | ReadonlyArray<{
                  readonly value: string
                  readonly label: string
                  readonly description?: string | undefined
                }>
              | undefined
            readonly custom?: boolean | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "number"
            readonly minimum?: number | undefined
            readonly maximum?: number | undefined
            readonly default?: number | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "integer"
            readonly minimum?: number | undefined
            readonly maximum?: number | undefined
            readonly default?: number | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "boolean"
            readonly default?: boolean | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "multiselect"
            readonly options: ReadonlyArray<{
              readonly value: string
              readonly label: string
              readonly description?: string | undefined
            }>
            readonly minItems?: number | undefined
            readonly maxItems?: number | undefined
            readonly custom?: boolean | undefined
            readonly default?: ReadonlyArray<string> | undefined
          }
        | {
            readonly key: string
            readonly type: "external"
            readonly url: string
            readonly title?: string | undefined
            readonly description?: string | undefined
          }
      >,
    ]
  }["metadata"]
  readonly fields: {
    readonly id?: string & Brand.Brand<"Form.ID">
    readonly title: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly fields: readonly [
      (
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "string"
            readonly secret?: boolean | undefined
            readonly multiline?: boolean | undefined
            readonly format?: "email" | "uri" | "date" | "date-time" | undefined
            readonly minLength?: number | undefined
            readonly maxLength?: number | undefined
            readonly pattern?: string | undefined
            readonly placeholder?: string | undefined
            readonly default?: string | undefined
            readonly options?:
              | ReadonlyArray<{
                  readonly value: string
                  readonly label: string
                  readonly description?: string | undefined
                }>
              | undefined
            readonly custom?: boolean | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "number"
            readonly minimum?: number | undefined
            readonly maximum?: number | undefined
            readonly default?: number | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "integer"
            readonly minimum?: number | undefined
            readonly maximum?: number | undefined
            readonly default?: number | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "boolean"
            readonly default?: boolean | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "multiselect"
            readonly options: ReadonlyArray<{
              readonly value: string
              readonly label: string
              readonly description?: string | undefined
            }>
            readonly minItems?: number | undefined
            readonly maxItems?: number | undefined
            readonly custom?: boolean | undefined
            readonly default?: ReadonlyArray<string> | undefined
          }
        | {
            readonly key: string
            readonly type: "external"
            readonly url: string
            readonly title?: string | undefined
            readonly description?: string | undefined
          }
      ),
      ...Array<
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "string"
            readonly secret?: boolean | undefined
            readonly multiline?: boolean | undefined
            readonly format?: "email" | "uri" | "date" | "date-time" | undefined
            readonly minLength?: number | undefined
            readonly maxLength?: number | undefined
            readonly pattern?: string | undefined
            readonly placeholder?: string | undefined
            readonly default?: string | undefined
            readonly options?:
              | ReadonlyArray<{
                  readonly value: string
                  readonly label: string
                  readonly description?: string | undefined
                }>
              | undefined
            readonly custom?: boolean | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "number"
            readonly minimum?: number | undefined
            readonly maximum?: number | undefined
            readonly default?: number | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "integer"
            readonly minimum?: number | undefined
            readonly maximum?: number | undefined
            readonly default?: number | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "boolean"
            readonly default?: boolean | undefined
          }
        | {
            readonly key: string
            readonly title?: string | undefined
            readonly description?: string | undefined
            readonly required?: boolean | undefined
            readonly when?:
              | ReadonlyArray<{
                  readonly key: string
                  readonly op: "eq" | "neq"
                  readonly value: string | number | boolean
                }>
              | undefined
            readonly type: "multiselect"
            readonly options: ReadonlyArray<{
              readonly value: string
              readonly label: string
              readonly description?: string | undefined
            }>
            readonly minItems?: number | undefined
            readonly maxItems?: number | undefined
            readonly custom?: boolean | undefined
            readonly default?: ReadonlyArray<string> | undefined
          }
        | {
            readonly key: string
            readonly type: "external"
            readonly url: string
            readonly title?: string | undefined
            readonly description?: string | undefined
          }
      >,
    ]
  }["fields"]
}

export type FormCreateOutput = FormInfo

export type FormGetInput = {
  readonly sessionID: {
    readonly sessionID: string & Brand.Brand<"Session.ID">
    readonly formID: string & Brand.Brand<"Form.ID">
  }["sessionID"]
  readonly formID: {
    readonly sessionID: string & Brand.Brand<"Session.ID">
    readonly formID: string & Brand.Brand<"Form.ID">
  }["formID"]
}

export type FormGetOutput = FormInfo

export type FormStateInput = {
  readonly sessionID: {
    readonly sessionID: string & Brand.Brand<"Session.ID">
    readonly formID: string & Brand.Brand<"Form.ID">
  }["sessionID"]
  readonly formID: {
    readonly sessionID: string & Brand.Brand<"Session.ID">
    readonly formID: string & Brand.Brand<"Form.ID">
  }["formID"]
}

export type FormStateOutput = FormState

export type FormReplyInput = {
  readonly sessionID: {
    readonly sessionID: string & Brand.Brand<"Session.ID">
    readonly formID: string & Brand.Brand<"Form.ID">
  }["sessionID"]
  readonly formID: {
    readonly sessionID: string & Brand.Brand<"Session.ID">
    readonly formID: string & Brand.Brand<"Form.ID">
  }["formID"]
  readonly answer: {
    readonly answer: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> }
  }["answer"]
}

export type FormReplyOutput = void

export type FormCancelInput = {
  readonly sessionID: {
    readonly sessionID: string & Brand.Brand<"Session.ID">
    readonly formID: string & Brand.Brand<"Form.ID">
  }["sessionID"]
  readonly formID: {
    readonly sessionID: string & Brand.Brand<"Session.ID">
    readonly formID: string & Brand.Brand<"Form.ID">
  }["formID"]
}

export type FormCancelOutput = void
