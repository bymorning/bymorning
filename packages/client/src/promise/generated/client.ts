import { Schema } from "effect"
import { HttpApi, HttpApiSchema } from "effect/unstable/httpapi"
import { ClientApi } from "../../contract.js"
import type {
  ServerSystemHealthOutput,
  AuthLoginInput,
  AuthLoginOutput,
  AuthCallbackInput,
  AuthCallbackOutput,
  AuthCallbackProviderInput,
  AuthCallbackProviderOutput,
  AuthMethodOutput,
  AuthInspectInput,
  AuthInspectOutput,
  AuthSetupInput,
  AuthSetupOutput,
  AuthIntegrationCallbackInput,
  AuthIntegrationCallbackOutput,
  AuthIntegrationPageOutput,
  AuthLogoutInput,
  AuthLogoutOutput,
  ServerShareGetInput,
  ServerShareGetOutput,
  AccountGetOutput,
  AccountSessionListOutput,
  AccountSessionRevokeInput,
  AccountSessionRevokeOutput,
  AccountGrantListOutput,
  AccountGrantRevokeInput,
  AccountGrantRevokeOutput,
  AccountSuspendInput,
  AccountSuspendOutput,
  AccountRestoreInput,
  AccountRestoreOutput,
  WorkspaceListOutput,
  ApiAuthProviderAuthProviderListOutput,
  ApiAuthProviderAuthProviderCreateInput,
  ApiAuthProviderAuthProviderCreateOutput,
  ApiAuthProviderAuthProviderGetInput,
  ApiAuthProviderAuthProviderGetOutput,
  ApiAuthProviderAuthProviderUpdateInput,
  ApiAuthProviderAuthProviderUpdateOutput,
  InstallationSelfOutput,
  InstallationAdminListOutput,
  InstallationAdminGrantInput,
  InstallationAdminGrantOutput,
  InstallationAdminRevokeInput,
  InstallationAdminRevokeOutput,
  InstallationPolicyGetOutput,
  InstallationPolicyUpdateInput,
  InstallationPolicyUpdateOutput,
  ApiOauthRequestGetInput,
  ApiOauthRequestGetOutput,
  ApiOauthApproveInput,
  ApiOauthApproveOutput,
  ApiOauthDenyInput,
  ApiOauthDenyOutput,
  UserListInput,
  UserListOutput,
  UserInviteInput,
  UserInviteOutput,
  UserRemoveInput,
  UserRemoveOutput,
  ProviderListInput,
  ProviderListOutput,
  ProviderUpdateInput,
  ProviderUpdateOutput,
  ApiConfigGetInput,
  ApiConfigGetOutput,
  ApiConfigUpdateInput,
  ApiConfigUpdateOutput,
  ApiConfigRefreshInput,
  ApiConfigRefreshOutput,
  ProjectCreateInput,
  ProjectCreateOutput,
  ProjectListInput,
  ProjectListOutput,
  ProjectGetInput,
  ProjectGetOutput,
  ProjectUpdateInput,
  ProjectUpdateOutput,
  ProjectDeleteInput,
  ProjectDeleteOutput,
  ProjectDirectoryListInput,
  ProjectDirectoryListOutput,
  ProjectDirectoryReadInput,
  ProjectDirectoryReadOutput,
  ProjectDirectoryWriteInput,
  ProjectDirectoryWriteOutput,
  ProjectDirectoryDeleteInput,
  ProjectDirectoryDeleteOutput,
  ProjectDirectoryMoveInput,
  ProjectDirectoryMoveOutput,
  ScheduledTaskCreateInput,
  ScheduledTaskCreateOutput,
  ScheduledTaskListInput,
  ScheduledTaskListOutput,
  ScheduledTaskGetInput,
  ScheduledTaskGetOutput,
  ScheduledTaskUpdateInput,
  ScheduledTaskUpdateOutput,
  ScheduledTaskDeleteInput,
  ScheduledTaskDeleteOutput,
  ScheduledTaskRunInput,
  ScheduledTaskRunOutput,
  ScheduledTaskDismissInput,
  ScheduledTaskDismissOutput,
  SkillListInput,
  SkillListOutput,
  SkillGetInput,
  SkillGetOutput,
  SkillCreateInput,
  SkillCreateOutput,
  SkillUpdateInput,
  SkillUpdateOutput,
  SkillDeleteInput,
  SkillDeleteOutput,
  ApiPolicyListInput,
  ApiPolicyListOutput,
  ApiPolicyCreateInput,
  ApiPolicyCreateOutput,
  ApiPolicyUpdateInput,
  ApiPolicyUpdateOutput,
  ApiPolicyDeleteInput,
  ApiPolicyDeleteOutput,
  ApiPolicySetEnabledInput,
  ApiPolicySetEnabledOutput,
  ApiPolicyValidateInput,
  ApiPolicyValidateOutput,
  ApiPolicySimulateInput,
  ApiPolicySimulateOutput,
  CommandListInput,
  CommandListOutput,
  ReferenceListInput,
  ReferenceListOutput,
  UsageListInput,
  UsageListOutput,
  UsageRecordsInput,
  UsageRecordsOutput,
  UsageOverviewInput,
  UsageOverviewOutput,
  UsageLeaderboardInput,
  UsageLeaderboardOutput,
  ToolUsageListInput,
  ToolUsageListOutput,
  ModelListInput,
  ModelListOutput,
  ModelAutoInput,
  ModelAutoOutput,
  ModelRouteInput,
  ModelRouteOutput,
  ModelToggleInput,
  ModelToggleOutput,
  ModelDefaultInput,
  ModelDefaultOutput,
  ModelCreateInput,
  ModelCreateOutput,
  ModelUpdateInput,
  ModelUpdateOutput,
  ModelDeleteInput,
  ModelDeleteOutput,
  IntegrationListInput,
  IntegrationListOutput,
  IntegrationGetInput,
  IntegrationGetOutput,
  IntegrationConnectKeyInput,
  IntegrationConnectKeyOutput,
  IntegrationConnectValuesInput,
  IntegrationConnectValuesOutput,
  IntegrationConnectAwsSigV4Input,
  IntegrationConnectAwsSigV4Output,
  IntegrationOauthClientPutInput,
  IntegrationOauthClientPutOutput,
  IntegrationOauthClientRemoveInput,
  IntegrationOauthClientRemoveOutput,
  IntegrationOauthConnectInput,
  IntegrationOauthConnectOutput,
  IntegrationOauthStatusInput,
  IntegrationOauthStatusOutput,
  IntegrationOauthCompleteInput,
  IntegrationOauthCompleteOutput,
  IntegrationOauthCancelInput,
  IntegrationOauthCancelOutput,
  IntegrationCommandConnectInput,
  IntegrationCommandConnectOutput,
  IntegrationCommandStatusInput,
  IntegrationCommandStatusOutput,
  IntegrationCommandCancelInput,
  IntegrationCommandCancelOutput,
  McpServersUpdateInput,
  McpServersUpdateOutput,
  McpToolsListInput,
  McpToolsListOutput,
  McpServersListInput,
  McpServersListOutput,
  McpServersPutInput,
  McpServersPutOutput,
  McpServersRemoveInput,
  McpServersRemoveOutput,
  McpServersMembersInput,
  McpServersMembersOutput,
  McpServersConnectInput,
  McpServersConnectOutput,
  McpServersDisconnectInput,
  McpServersDisconnectOutput,
  McpServersTestInput,
  McpServersTestOutput,
  CredentialUpdateInput,
  CredentialUpdateOutput,
  CredentialActivateInput,
  CredentialActivateOutput,
  CredentialRemoveInput,
  CredentialRemoveOutput,
  WebsearchProvidersInput,
  WebsearchProvidersOutput,
  WebsearchQueryInput,
  WebsearchQueryOutput,
  SessionCreateInput,
  SessionCreateOutput,
  SessionListInput,
  SessionListOutput,
  SessionActiveInput,
  SessionActiveOutput,
  SessionGetInput,
  SessionGetOutput,
  SessionUpdateInput,
  SessionUpdateOutput,
  SessionDeleteInput,
  SessionDeleteOutput,
  SessionInboxListInput,
  SessionInboxListOutput,
  SessionPromptInput,
  SessionPromptOutput,
  SessionCompactInput,
  SessionCompactOutput,
  SessionInterruptInput,
  SessionInterruptOutput,
  SessionBackgroundInput,
  SessionBackgroundOutput,
  SessionSwitchAgentInput,
  SessionSwitchAgentOutput,
  SessionSwitchModelInput,
  SessionSwitchModelOutput,
  SessionRenameInput,
  SessionRenameOutput,
  SessionCommandInput,
  SessionCommandOutput,
  SessionSyntheticInput,
  SessionSyntheticOutput,
  SessionWaitInput,
  SessionWaitOutput,
  SessionGenerateInput,
  SessionGenerateOutput,
  SessionEntryListInput,
  SessionEntryListOutput,
  SessionEntryPutInput,
  SessionEntryPutOutput,
  SessionEntryRemoveInput,
  SessionEntryRemoveOutput,
  MessageListInput,
  MessageListOutput,
  EventSubscribeInput,
  EventSubscribeOutput,
  AgentListInput,
  AgentListOutput,
  AgentGetInput,
  AgentGetOutput,
  AgentCreateInput,
  AgentCreateOutput,
  AgentUpdateInput,
  AgentUpdateOutput,
  AgentDeleteInput,
  AgentDeleteOutput,
  ApiAuditListInput,
  ApiAuditListOutput,
  ServiceAccountListInput,
  ServiceAccountListOutput,
  ServiceAccountCreateInput,
  ServiceAccountCreateOutput,
  ServiceAccountGetInput,
  ServiceAccountGetOutput,
  ServiceAccountUpdateInput,
  ServiceAccountUpdateOutput,
  ServiceAccountRemoveInput,
  ServiceAccountRemoveOutput,
  ServiceAccountKeyListInput,
  ServiceAccountKeyListOutput,
  ServiceAccountKeyCreateInput,
  ServiceAccountKeyCreateOutput,
  ServiceAccountKeyRevokeInput,
  ServiceAccountKeyRevokeOutput,
  BudgetStatusInput,
  BudgetStatusOutput,
  BudgetLimitInput,
  BudgetLimitOutput,
  PermissionRequestListInput,
  PermissionRequestListOutput,
  PermissionSavedListInput,
  PermissionSavedListOutput,
  PermissionSavedRemoveInput,
  PermissionSavedRemoveOutput,
  PermissionToolsListInput,
  PermissionToolsListOutput,
  PermissionToolsUpdateInput,
  PermissionToolsUpdateOutput,
  PermissionCreateInput,
  PermissionCreateOutput,
  PermissionListInput,
  PermissionListOutput,
  PermissionGetInput,
  PermissionGetOutput,
  PermissionReplyInput,
  PermissionReplyOutput,
  FormRequestListInput,
  FormRequestListOutput,
  FormCallerListInput,
  FormCallerListOutput,
  FormCallerGetInput,
  FormCallerGetOutput,
  FormCallerStateInput,
  FormCallerStateOutput,
  FormCallerReplyInput,
  FormCallerReplyOutput,
  FormCallerCancelInput,
  FormCallerCancelOutput,
  FormListInput,
  FormListOutput,
  FormCreateInput,
  FormCreateOutput,
  FormGetInput,
  FormGetOutput,
  FormStateInput,
  FormStateOutput,
  FormReplyInput,
  FormReplyOutput,
  FormCancelInput,
  FormCancelOutput,
} from "./types.js"
import { ClientError } from "./client-error.js"

export interface ClientOptions {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch
  readonly headers?: RequestInit["headers"]
}

export interface RequestOptions {
  readonly signal?: AbortSignal
  readonly headers?: RequestInit["headers"]
}

interface RuntimeSchemas {
  readonly params: Schema.Top | undefined
  readonly query: Schema.Top | undefined
  readonly headers: Schema.Top | undefined
  readonly payload: Schema.Top | undefined
  readonly success: Schema.Top | undefined
  readonly successes: ReadonlyMap<number, Schema.Top>
  readonly errors: ReadonlyMap<number, Schema.Top>
}

interface RequestDescriptor {
  readonly schemaKey: string
  readonly method: string
  readonly path: (params: Record<string, unknown>, wildcard?: string) => string
  readonly params?: unknown
  readonly query?: unknown
  readonly headers?: unknown
  readonly body?: unknown
  readonly wildcard?: string
  readonly successStatus: number
  readonly empty: boolean
  readonly binaryBody?: true
  readonly binary?: true
  readonly text?: true
}

const union = (values: readonly [Schema.Top, ...Array<Schema.Top>]): Schema.Top =>
  values.length === 1 ? values[0] : Schema.Union(values)

const schemas = new Map<string, RuntimeSchemas>()
HttpApi.reflect(ClientApi, {
  onGroup() {},
  onEndpoint({ endpoint, errors, group, successes }) {
    const payloads = Array.from(endpoint.payload.values()).flatMap(({ schemas }) => schemas)
    const sourceSuccess = Array.from(endpoint.success)[0]
    schemas.set(JSON.stringify([group.identifier, endpoint.identifier]), {
      params: endpoint.params,
      query: endpoint.query,
      headers: endpoint.headers,
      payload: payloads.length === 0 ? undefined : payloads.length === 1 ? payloads[0] : Schema.Union(payloads),
      success: sourceSuccess,
      successes: new Map(Array.from(successes, ([status, values]) => [status, sourceSuccess ?? union(values)])),
      errors: new Map(Array.from(errors, ([status, values]) => [status, union(values)])),
    })
  },
})

const maxSseEventBytes = 16 * 1024 * 1024
const responseOptions = { onExcessProperty: "preserve" } as const

export function make(options: ClientOptions) {
  const fetch = options.fetch ?? globalThis.fetch

  const runtime = (descriptor: RequestDescriptor) => {
    const value = schemas.get(descriptor.schemaKey)
    if (value === undefined) throw new ClientError("Schema", { cause: new Error("Missing endpoint schema") })
    return value
  }

  const encode = async (schema: Schema.Top | undefined, value: unknown) => {
    if (schema === undefined) return value
    try {
      return await Schema.encodeUnknownPromise(schema as Schema.Codec<unknown, unknown>)(value)
    } catch (cause) {
      throw new ClientError("Schema", { cause })
    }
  }

  const decode = async <A>(schema: Schema.Top, value: unknown): Promise<A> => {
    try {
      return (await Schema.decodeUnknownPromise(schema as Schema.Codec<unknown, unknown>, responseOptions)(value)) as A
    } catch (cause) {
      throw new ClientError("Schema", { cause })
    }
  }

  const prepare = async (descriptor: RequestDescriptor, requestOptions?: RequestOptions) => {
    const endpoint = runtime(descriptor)
    const [params, query, requestHeaders, body] = await Promise.all([
      encode(endpoint.params, descriptor.params),
      encode(endpoint.query, descriptor.query),
      encode(endpoint.headers, descriptor.headers),
      encode(endpoint.payload, descriptor.body),
    ])
    const url = new URL(
      descriptor.path((params ?? {}) as Record<string, unknown>, descriptor.wildcard),
      options.baseUrl,
    )
    for (const [key, value] of Object.entries((query ?? {}) as Record<string, unknown>))
      appendQuery(url.searchParams, key, value)
    const headers = new Headers(options.headers)
    for (const [key, value] of Object.entries((requestHeaders ?? {}) as Record<string, unknown>)) {
      if (value !== undefined && value !== null) headers.set(key, String(value))
    }
    for (const [key, value] of new Headers(requestOptions?.headers)) headers.set(key, value)
    if (body !== undefined && !headers.has("content-type"))
      headers.set("content-type", descriptor.binaryBody ? "application/octet-stream" : "application/json")
    return {
      url,
      init: {
        method: descriptor.method,
        ...(requestOptions?.signal === undefined ? {} : { signal: requestOptions.signal }),
        headers,
        ...(body === undefined
          ? {}
          : { body: descriptor.binaryBody ? (body as Exclude<RequestInit["body"], undefined>) : JSON.stringify(body) }),
      } satisfies RequestInit,
    }
  }

  const execute = async (descriptor: RequestDescriptor, requestOptions?: RequestOptions) => {
    try {
      const prepared = await prepare(descriptor, requestOptions)
      return await fetch(prepared.url, prepared.init)
    } catch (cause) {
      if (cause instanceof ClientError) throw cause
      throw new ClientError("Transport", { cause })
    }
  }

  const responseError = async (response: Response, descriptor: RequestDescriptor): Promise<never> => {
    const error = runtime(descriptor).errors.get(response.status)
    if (error !== undefined) throw await decode(error, await json(response))
    try {
      await response.body?.cancel()
    } catch {}
    throw new ClientError("UnexpectedStatus", { cause: { status: response.status } })
  }

  const request = async <A>(descriptor: RequestDescriptor, requestOptions?: RequestOptions): Promise<A> => {
    const response = await execute(descriptor, requestOptions)
    if (response.status !== descriptor.successStatus) return responseError(response, descriptor)
    const schema = runtime(descriptor).successes.get(response.status)
    if (schema === undefined) throw new ClientError("Schema", { cause: new Error("Missing success schema") })
    if (descriptor.empty) {
      try {
        await response.body?.cancel()
      } catch {}
      return undefined as A
    }
    if (descriptor.binary) {
      requireContentType(response, "application/octet-stream")
      try {
        return await decode<A>(schema, new Uint8Array(await response.arrayBuffer()))
      } catch (cause) {
        if (cause instanceof ClientError) throw cause
        throw new ClientError("Transport", { cause })
      }
    }
    if (descriptor.text) {
      requireContentType(response, "text/plain")
      try {
        return await decode<A>(schema, await response.text())
      } catch (cause) {
        if (cause instanceof ClientError) throw cause
        throw new ClientError("Transport", { cause })
      }
    }
    return await decode<A>(schema, await json(response))
  }

  const sse = <A>(descriptor: RequestDescriptor, requestOptions?: RequestOptions): AsyncIterable<A> => ({
    async *[Symbol.asyncIterator]() {
      const response = await execute(descriptor, requestOptions)
      if (response.status !== descriptor.successStatus) await responseError(response, descriptor)
      requireContentType(response, "text/event-stream")
      if (response.body === null) throw new ClientError("MalformedResponse")
      const success = runtime(descriptor).success
      if (success === undefined || !("_tag" in success) || success._tag !== "StreamSse") {
        throw new ClientError("Schema", { cause: new Error("Missing SSE schema") })
      }
      const events = (success as HttpApiSchema.StreamSse<any, any>).events
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      const encoder = new TextEncoder()
      let buffer = ""
      // Pending bytes grow by each chunk and are re-measured only from the small
      // remainder after complete events are consumed, instead of re-encoding the
      // whole buffer for every chunk.
      let pending = 0
      try {
        while (true) {
          let next
          try {
            next = await reader.read()
          } catch (cause) {
            throw new ClientError("Transport", { cause })
          }
          buffer += decoder.decode(next.value, { stream: !next.done })
          pending += next.value?.byteLength ?? 0
          if (pending > maxSseEventBytes) throw new ClientError("SseEventTooLarge")
          const trailingCarriageReturn = !next.done && buffer.endsWith("\r")
          if (trailingCarriageReturn) buffer = buffer.slice(0, -1)
          buffer = buffer.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
          if (trailingCarriageReturn) buffer += "\r"
          if (next.done && buffer !== "") buffer += "\n\n"
          let boundary = buffer.indexOf("\n\n")
          const consumed = boundary >= 0
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const value = block
              .split("\n")
              .flatMap((line) => (line.startsWith("data:") ? [line.slice(5).trimStart()] : []))
              .join("\n")
            if (value !== "") {
              try {
                JSON.parse(value)
              } catch (cause) {
                throw new ClientError("MalformedResponse", { cause })
              }
              const event = await decode<{ readonly data: A }>(events, { id: undefined, event: "message", data: value })
              yield event.data
            }
            boundary = buffer.indexOf("\n\n")
          }
          if (consumed) pending = buffer === "" ? 0 : encoder.encode(buffer).byteLength
          if (next.done) return
        }
      } finally {
        try {
          await reader.cancel()
        } catch {}
        reader.releaseLock()
      }
    },
  })

  return {
    "server.system": {
      health: (requestOptions?: RequestOptions) =>
        request<ServerSystemHealthOutput>(
          {
            schemaKey: '["server.system","system.health"]',
            method: "GET",
            path: (params, wildcard) => `/system/health`,
            successStatus: 200,
            empty: false,
            text: true,
          },
          requestOptions,
        ),
    },
    auth: {
      login: (input?: AuthLoginInput, requestOptions?: RequestOptions) =>
        request<AuthLoginOutput>(
          {
            schemaKey: '["auth","auth.login"]',
            method: "GET",
            path: (params, wildcard) => `/auth/login`,
            query: {
              ...(input?.["redirect"] === undefined ? {} : { redirect: input?.["redirect"] }),
              ...(input?.["provider"] === undefined ? {} : { provider: input?.["provider"] }),
            },
            successStatus: 302,
            empty: true,
          },
          requestOptions,
        ),
      callback: (input: AuthCallbackInput, requestOptions?: RequestOptions) =>
        request<AuthCallbackOutput>(
          {
            schemaKey: '["auth","auth.callback"]',
            method: "GET",
            path: (params, wildcard) => `/auth/callback`,
            query: { code: input["code"], state: input["state"] },
            successStatus: 303,
            empty: true,
          },
          requestOptions,
        ),
      callbackProvider: (input: AuthCallbackProviderInput, requestOptions?: RequestOptions) =>
        request<AuthCallbackProviderOutput>(
          {
            schemaKey: '["auth","auth.callbackProvider"]',
            method: "GET",
            path: (params, wildcard) => `/auth/callback/${encodeURIComponent(String(params["providerID"]))}`,
            params: { providerID: input["providerID"] },
            query: { code: input["code"], state: input["state"] },
            successStatus: 303,
            empty: true,
          },
          requestOptions,
        ),
      method: (requestOptions?: RequestOptions) =>
        request<AuthMethodOutput>(
          {
            schemaKey: '["auth","auth.method"]',
            method: "GET",
            path: (params, wildcard) => `/auth/method`,
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      inspect: (input: AuthInspectInput, requestOptions?: RequestOptions) =>
        request<AuthInspectOutput>(
          {
            schemaKey: '["auth","auth.inspect"]',
            method: "POST",
            path: (params, wildcard) => `/auth/inspect`,
            body: { token: input["token"] },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      setup: (input: AuthSetupInput, requestOptions?: RequestOptions) =>
        request<AuthSetupOutput>(
          {
            schemaKey: '["auth","auth.setup"]',
            method: "POST",
            path: (params, wildcard) => `/auth/setup`,
            body: input["payload"],
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      integration: {
        callback: (input?: AuthIntegrationCallbackInput, requestOptions?: RequestOptions) =>
          request<AuthIntegrationCallbackOutput>(
            {
              schemaKey: '["auth","auth.integration.callback"]',
              method: "GET",
              path: (params, wildcard) => `/auth/integration/callback`,
              query: {
                ...(input?.["state"] === undefined ? {} : { state: input?.["state"] }),
                ...(input?.["code"] === undefined ? {} : { code: input?.["code"] }),
                ...(input?.["error"] === undefined ? {} : { error: input?.["error"] }),
                ...(input?.["error_description"] === undefined
                  ? {}
                  : { error_description: input?.["error_description"] }),
              },
              successStatus: 303,
              empty: true,
            },
            requestOptions,
          ),
        page: (requestOptions?: RequestOptions) =>
          request<AuthIntegrationPageOutput>(
            {
              schemaKey: '["auth","auth.integration.page"]',
              method: "GET",
              path: (params, wildcard) => `/auth/integration/callback/complete`,
              successStatus: 200,
              empty: false,
              text: true,
            },
            requestOptions,
          ),
      },
      logout: (input?: AuthLogoutInput, requestOptions?: RequestOptions) =>
        request<AuthLogoutOutput>(
          {
            schemaKey: '["auth","auth.logout"]',
            method: "POST",
            path: (params, wildcard) => `/auth/logout`,
            headers: { ...(input?.["origin"] === undefined ? {} : { origin: input?.["origin"] }) },
            successStatus: 204,
            empty: true,
          },
          requestOptions,
        ),
    },
    "server.share": {
      get: (input: ServerShareGetInput, requestOptions?: RequestOptions) =>
        request<ServerShareGetOutput>(
          {
            schemaKey: '["server.share","share.get"]',
            method: "GET",
            path: (params, wildcard) =>
              `/api/public/share/${encodeURIComponent(String(params["workspaceID"]))}/${encodeURIComponent(String(params["token"]))}`,
            params: { workspaceID: input["workspaceID"], token: input["token"] },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
    },
    account: {
      get: (requestOptions?: RequestOptions) =>
        request<AccountGetOutput>(
          {
            schemaKey: '["api.account","account.get"]',
            method: "GET",
            path: (params, wildcard) => `/api/account`,
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      session: {
        list: (requestOptions?: RequestOptions) =>
          request<AccountSessionListOutput>(
            {
              schemaKey: '["api.account","account.session.list"]',
              method: "GET",
              path: (params, wildcard) => `/api/account/sessions`,
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
        revoke: (input: AccountSessionRevokeInput, requestOptions?: RequestOptions) =>
          request<AccountSessionRevokeOutput>(
            {
              schemaKey: '["api.account","account.session.revoke"]',
              method: "DELETE",
              path: (params, wildcard) => `/api/account/sessions/${encodeURIComponent(String(params["sessionID"]))}`,
              params: { sessionID: input["sessionID"] },
              successStatus: 204,
              empty: true,
            },
            requestOptions,
          ),
      },
      grant: {
        list: (requestOptions?: RequestOptions) =>
          request<AccountGrantListOutput>(
            {
              schemaKey: '["api.account","account.grant.list"]',
              method: "GET",
              path: (params, wildcard) => `/api/account/grants`,
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
        revoke: (input: AccountGrantRevokeInput, requestOptions?: RequestOptions) =>
          request<AccountGrantRevokeOutput>(
            {
              schemaKey: '["api.account","account.grant.revoke"]',
              method: "DELETE",
              path: (params, wildcard) => `/api/account/grants/${encodeURIComponent(String(params["grantID"]))}`,
              params: { grantID: input["grantID"] },
              successStatus: 204,
              empty: true,
            },
            requestOptions,
          ),
      },
      suspend: (input: AccountSuspendInput, requestOptions?: RequestOptions) =>
        request<AccountSuspendOutput>(
          {
            schemaKey: '["api.account","account.suspend"]',
            method: "POST",
            path: (params, wildcard) => `/api/accounts/${encodeURIComponent(String(params["accountID"]))}/suspend`,
            params: { accountID: input["accountID"] },
            successStatus: 204,
            empty: true,
          },
          requestOptions,
        ),
      restore: (input: AccountRestoreInput, requestOptions?: RequestOptions) =>
        request<AccountRestoreOutput>(
          {
            schemaKey: '["api.account","account.restore"]',
            method: "POST",
            path: (params, wildcard) => `/api/accounts/${encodeURIComponent(String(params["accountID"]))}/restore`,
            params: { accountID: input["accountID"] },
            successStatus: 204,
            empty: true,
          },
          requestOptions,
        ),
    },
    workspace: {
      list: (requestOptions?: RequestOptions) =>
        request<WorkspaceListOutput>(
          {
            schemaKey: '["api.workspace","workspace.list"]',
            method: "GET",
            path: (params, wildcard) => `/api/workspaces`,
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
    },
    "api.auth-provider": {
      authProvider: {
        list: (requestOptions?: RequestOptions) =>
          request<ApiAuthProviderAuthProviderListOutput>(
            {
              schemaKey: '["api.auth-provider","authProvider.list"]',
              method: "GET",
              path: (params, wildcard) => `/api/auth-provider`,
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
        create: (input: ApiAuthProviderAuthProviderCreateInput, requestOptions?: RequestOptions) =>
          request<ApiAuthProviderAuthProviderCreateOutput>(
            {
              schemaKey: '["api.auth-provider","authProvider.create"]',
              method: "POST",
              path: (params, wildcard) => `/api/auth-provider`,
              body: {
                id: input["id"],
                displayName: input["displayName"],
                kind: input["kind"],
                domains: input["domains"],
                issuer: input["issuer"],
                clientID: input["clientID"],
                clientSecret: input["clientSecret"],
              },
              successStatus: 201,
              empty: false,
            },
            requestOptions,
          ),
        get: (input: ApiAuthProviderAuthProviderGetInput, requestOptions?: RequestOptions) =>
          request<ApiAuthProviderAuthProviderGetOutput>(
            {
              schemaKey: '["api.auth-provider","authProvider.get"]',
              method: "GET",
              path: (params, wildcard) => `/api/auth-provider/${encodeURIComponent(String(params["providerID"]))}`,
              params: { providerID: input["providerID"] },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
        update: (input: ApiAuthProviderAuthProviderUpdateInput, requestOptions?: RequestOptions) =>
          request<ApiAuthProviderAuthProviderUpdateOutput>(
            {
              schemaKey: '["api.auth-provider","authProvider.update"]',
              method: "PUT",
              path: (params, wildcard) => `/api/auth-provider/${encodeURIComponent(String(params["providerID"]))}`,
              params: { providerID: input["providerID"] },
              body: {
                id: input["id"],
                revision: input["revision"],
                displayName: input["displayName"],
                kind: input["kind"],
                domains: input["domains"],
                status: input["status"],
                ...(input["clientSecret"] === undefined ? {} : { clientSecret: input["clientSecret"] }),
              },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
      },
    },
    installation: {
      self: (requestOptions?: RequestOptions) =>
        request<InstallationSelfOutput>(
          {
            schemaKey: '["api.installation","installation.self"]',
            method: "GET",
            path: (params, wildcard) => `/api/installation/self`,
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      admin: {
        list: (requestOptions?: RequestOptions) =>
          request<InstallationAdminListOutput>(
            {
              schemaKey: '["api.installation","installation.admin.list"]',
              method: "GET",
              path: (params, wildcard) => `/api/installation/admin`,
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
        grant: (input: InstallationAdminGrantInput, requestOptions?: RequestOptions) =>
          request<InstallationAdminGrantOutput>(
            {
              schemaKey: '["api.installation","installation.admin.grant"]',
              method: "POST",
              path: (params, wildcard) => `/api/installation/admin`,
              body: { accountID: input["accountID"] },
              successStatus: 201,
              empty: false,
            },
            requestOptions,
          ),
        revoke: (input: InstallationAdminRevokeInput, requestOptions?: RequestOptions) =>
          request<InstallationAdminRevokeOutput>(
            {
              schemaKey: '["api.installation","installation.admin.revoke"]',
              method: "DELETE",
              path: (params, wildcard) => `/api/installation/admin/${encodeURIComponent(String(params["accountID"]))}`,
              params: { accountID: input["accountID"] },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
      },
      policy: {
        get: (requestOptions?: RequestOptions) =>
          request<InstallationPolicyGetOutput>(
            {
              schemaKey: '["api.installation","installation.policy.get"]',
              method: "GET",
              path: (params, wildcard) => `/api/installation/policy`,
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
        update: (input?: InstallationPolicyUpdateInput, requestOptions?: RequestOptions) =>
          request<InstallationPolicyUpdateOutput>(
            {
              schemaKey: '["api.installation","installation.policy.update"]',
              method: "PUT",
              path: (params, wildcard) => `/api/installation/policy`,
              body: {
                ...(input?.["providers"] === undefined ? {} : { providers: input?.["providers"] }),
                ...(input?.["plugins"] === undefined ? {} : { plugins: input?.["plugins"] }),
                ...(input?.["websearch"] === undefined ? {} : { websearch: input?.["websearch"] }),
                ...(input?.["share"] === undefined ? {} : { share: input?.["share"] }),
                ...(input?.["provisioning"] === undefined ? {} : { provisioning: input?.["provisioning"] }),
                ...(input?.["invitations"] === undefined ? {} : { invitations: input?.["invitations"] }),
              },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
      },
    },
    "api.oauth": {
      request: {
        get: (input: ApiOauthRequestGetInput, requestOptions?: RequestOptions) =>
          request<ApiOauthRequestGetOutput>(
            {
              schemaKey: '["api.oauth","oauth.request.get"]',
              method: "GET",
              path: (params, wildcard) => `/api/oauth/request`,
              query: { id: input["id"] },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
      },
      approve: (input: ApiOauthApproveInput, requestOptions?: RequestOptions) =>
        request<ApiOauthApproveOutput>(
          {
            schemaKey: '["api.oauth","oauth.approve"]',
            method: "POST",
            path: (params, wildcard) => `/api/oauth/approve`,
            body: { requestID: input["requestID"], workspaceID: input["workspaceID"] },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      deny: (input: ApiOauthDenyInput, requestOptions?: RequestOptions) =>
        request<ApiOauthDenyOutput>(
          {
            schemaKey: '["api.oauth","oauth.deny"]',
            method: "POST",
            path: (params, wildcard) => `/api/oauth/deny`,
            body: { requestID: input["requestID"] },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
    },
    user: {
      list: (input?: UserListInput, requestOptions?: RequestOptions) =>
        request<UserListOutput>(
          {
            schemaKey: '["api.user","user.list"]',
            method: "GET",
            path: (params, wildcard) => `/api/users`,
            query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      invite: (input: UserInviteInput, requestOptions?: RequestOptions) =>
        request<UserInviteOutput>(
          {
            schemaKey: '["api.user","user.invite"]',
            method: "POST",
            path: (params, wildcard) => `/api/users`,
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: { email: input["email"], role: input["role"] },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: UserRemoveInput, requestOptions?: RequestOptions) =>
        request<UserRemoveOutput>(
          {
            schemaKey: '["api.user","user.remove"]',
            method: "DELETE",
            path: (params, wildcard) => `/api/users/${encodeURIComponent(String(params["userID"]))}`,
            params: { userID: input["userID"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            successStatus: 204,
            empty: true,
          },
          requestOptions,
        ),
    },
    provider: {
      list: (input?: ProviderListInput, requestOptions?: RequestOptions) =>
        request<ProviderListOutput>(
          {
            schemaKey: '["api.provider","provider.list"]',
            method: "GET",
            path: (params, wildcard) => `/api/providers`,
            query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      update: (input: ProviderUpdateInput, requestOptions?: RequestOptions) =>
        request<ProviderUpdateOutput>(
          {
            schemaKey: '["api.provider","provider.update"]',
            method: "PUT",
            path: (params, wildcard) => `/api/providers/activation`,
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: { provider: input["provider"], status: input["status"] },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
    },
    "api.config": {
      get: (input?: ApiConfigGetInput, requestOptions?: RequestOptions) =>
        request<ApiConfigGetOutput>(
          {
            schemaKey: '["api.config","config.get"]',
            method: "GET",
            path: (params, wildcard) => `/api/config`,
            query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      update: (input?: ApiConfigUpdateInput, requestOptions?: RequestOptions) =>
        request<ApiConfigUpdateOutput>(
          {
            schemaKey: '["api.config","config.update"]',
            method: "PUT",
            path: (params, wildcard) => `/api/config`,
            query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
            body: {
              ...(input?.["default_agent"] === undefined ? {} : { default_agent: input?.["default_agent"] }),
              ...(input?.["compaction"] === undefined ? {} : { compaction: input?.["compaction"] }),
              ...(input?.["permissions"] === undefined ? {} : { permissions: input?.["permissions"] }),
              ...(input?.["plugins"] === undefined ? {} : { plugins: input?.["plugins"] }),
              ...(input?.["tool_output"] === undefined ? {} : { tool_output: input?.["tool_output"] }),
              ...(input?.["mcp"] === undefined ? {} : { mcp: input?.["mcp"] }),
              ...(input?.["websearch"] === undefined ? {} : { websearch: input?.["websearch"] }),
              ...(input?.["code_interpreter"] === undefined ? {} : { code_interpreter: input?.["code_interpreter"] }),
              ...(input?.["gateway"] === undefined ? {} : { gateway: input?.["gateway"] }),
              ...(input?.["providers"] === undefined ? {} : { providers: input?.["providers"] }),
              ...(input?.["routing"] === undefined ? {} : { routing: input?.["routing"] }),
              ...(input?.["models"] === undefined ? {} : { models: input?.["models"] }),
            },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      refresh: (input?: ApiConfigRefreshInput, requestOptions?: RequestOptions) =>
        request<ApiConfigRefreshOutput>(
          {
            schemaKey: '["api.config","config.refresh"]',
            method: "POST",
            path: (params, wildcard) => `/api/config/refresh`,
            query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
    },
    project: {
      create: (input?: ProjectCreateInput, requestOptions?: RequestOptions) =>
        request<ProjectCreateOutput>(
          {
            schemaKey: '["api.project","project.create"]',
            method: "POST",
            path: (params, wildcard) => `/api/project`,
            query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
            body: {
              ...(input?.["name"] === undefined ? {} : { name: input?.["name"] }),
              ...(input?.["icon"] === undefined ? {} : { icon: input?.["icon"] }),
            },
            successStatus: 201,
            empty: false,
          },
          requestOptions,
        ),
      list: (input?: ProjectListInput, requestOptions?: RequestOptions) =>
        request<ProjectListOutput>(
          {
            schemaKey: '["api.project","project.list"]',
            method: "GET",
            path: (params, wildcard) => `/api/project`,
            query: {
              ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }),
              ...(input?.["archived"] === undefined ? {} : { archived: input?.["archived"] }),
            },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      get: (input: ProjectGetInput, requestOptions?: RequestOptions) =>
        request<ProjectGetOutput>(
          {
            schemaKey: '["api.project","project.get"]',
            method: "GET",
            path: (params, wildcard) => `/api/project/${encodeURIComponent(String(params["projectID"]))}`,
            params: { projectID: input["projectID"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      update: (input: ProjectUpdateInput, requestOptions?: RequestOptions) =>
        request<ProjectUpdateOutput>(
          {
            schemaKey: '["api.project","project.update"]',
            method: "PATCH",
            path: (params, wildcard) => `/api/project/${encodeURIComponent(String(params["projectID"]))}`,
            params: { projectID: input["projectID"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: {
              ...(input["name"] === undefined ? {} : { name: input["name"] }),
              ...(input["icon"] === undefined ? {} : { icon: input["icon"] }),
              ...(input["archived"] === undefined ? {} : { archived: input["archived"] }),
            },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      delete: (input: ProjectDeleteInput, requestOptions?: RequestOptions) =>
        request<ProjectDeleteOutput>(
          {
            schemaKey: '["api.project","project.delete"]',
            method: "DELETE",
            path: (params, wildcard) => `/api/project/${encodeURIComponent(String(params["projectID"]))}`,
            params: { projectID: input["projectID"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            successStatus: 204,
            empty: true,
          },
          requestOptions,
        ),
      directory: {
        list: (input: ProjectDirectoryListInput, requestOptions?: RequestOptions) =>
          request<ProjectDirectoryListOutput>(
            {
              schemaKey: '["api.project","project.directory.list"]',
              method: "GET",
              path: (params, wildcard) => `/api/project/${encodeURIComponent(String(params["projectID"]))}/directory`,
              params: { projectID: input["projectID"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
        read: (input: ProjectDirectoryReadInput, requestOptions?: RequestOptions) =>
          request<ProjectDirectoryReadOutput>(
            {
              schemaKey: '["api.project","project.directory.read"]',
              method: "GET",
              path: (params, wildcard) =>
                `/api/project/${encodeURIComponent(String(params["projectID"]))}/directory/file`,
              params: { projectID: input["projectID"] },
              query: {
                path: input["path"],
                ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }),
              },
              successStatus: 200,
              empty: false,
              binary: true,
            },
            requestOptions,
          ),
        write: (input: ProjectDirectoryWriteInput, requestOptions?: RequestOptions) =>
          request<ProjectDirectoryWriteOutput>(
            {
              schemaKey: '["api.project","project.directory.write"]',
              method: "PUT",
              path: (params, wildcard) =>
                `/api/project/${encodeURIComponent(String(params["projectID"]))}/directory/file`,
              params: { projectID: input["projectID"] },
              query: {
                path: input["path"],
                ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }),
              },
              headers: { ...(input["contentType"] === undefined ? {} : { contentType: input["contentType"] }) },
              body: input["payload"],
              successStatus: 204,
              empty: true,
              binaryBody: true,
            },
            requestOptions,
          ),
        delete: (input: ProjectDirectoryDeleteInput, requestOptions?: RequestOptions) =>
          request<ProjectDirectoryDeleteOutput>(
            {
              schemaKey: '["api.project","project.directory.delete"]',
              method: "DELETE",
              path: (params, wildcard) =>
                `/api/project/${encodeURIComponent(String(params["projectID"]))}/directory/file`,
              params: { projectID: input["projectID"] },
              query: {
                path: input["path"],
                ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }),
              },
              successStatus: 204,
              empty: true,
            },
            requestOptions,
          ),
        move: (input: ProjectDirectoryMoveInput, requestOptions?: RequestOptions) =>
          request<ProjectDirectoryMoveOutput>(
            {
              schemaKey: '["api.project","project.directory.move"]',
              method: "POST",
              path: (params, wildcard) =>
                `/api/project/${encodeURIComponent(String(params["projectID"]))}/directory/move`,
              params: { projectID: input["projectID"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              body: { from: input["from"], to: input["to"] },
              successStatus: 204,
              empty: true,
            },
            requestOptions,
          ),
      },
    },
    scheduledTask: {
      create: (input: ScheduledTaskCreateInput, requestOptions?: RequestOptions) =>
        request<ScheduledTaskCreateOutput>(
          {
            schemaKey: '["api.scheduledTask","scheduledTask.create"]',
            method: "POST",
            path: (params, wildcard) => `/api/scheduled-task`,
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: {
              name: input["name"],
              prompt: input["prompt"],
              cron: input["cron"],
              timezone: input["timezone"],
              ...(input["projectID"] === undefined ? {} : { projectID: input["projectID"] }),
              ...(input["model"] === undefined ? {} : { model: input["model"] }),
              ...(input["enabled"] === undefined ? {} : { enabled: input["enabled"] }),
            },
            successStatus: 201,
            empty: false,
          },
          requestOptions,
        ),
      list: (input?: ScheduledTaskListInput, requestOptions?: RequestOptions) =>
        request<ScheduledTaskListOutput>(
          {
            schemaKey: '["api.scheduledTask","scheduledTask.list"]',
            method: "GET",
            path: (params, wildcard) => `/api/scheduled-task`,
            query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      get: (input: ScheduledTaskGetInput, requestOptions?: RequestOptions) =>
        request<ScheduledTaskGetOutput>(
          {
            schemaKey: '["api.scheduledTask","scheduledTask.get"]',
            method: "GET",
            path: (params, wildcard) => `/api/scheduled-task/${encodeURIComponent(String(params["taskID"]))}`,
            params: { taskID: input["taskID"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      update: (input: ScheduledTaskUpdateInput, requestOptions?: RequestOptions) =>
        request<ScheduledTaskUpdateOutput>(
          {
            schemaKey: '["api.scheduledTask","scheduledTask.update"]',
            method: "PATCH",
            path: (params, wildcard) => `/api/scheduled-task/${encodeURIComponent(String(params["taskID"]))}`,
            params: { taskID: input["taskID"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: {
              ...(input["name"] === undefined ? {} : { name: input["name"] }),
              ...(input["prompt"] === undefined ? {} : { prompt: input["prompt"] }),
              ...(input["cron"] === undefined ? {} : { cron: input["cron"] }),
              ...(input["timezone"] === undefined ? {} : { timezone: input["timezone"] }),
              ...(input["projectID"] === undefined ? {} : { projectID: input["projectID"] }),
              ...(input["model"] === undefined ? {} : { model: input["model"] }),
              ...(input["enabled"] === undefined ? {} : { enabled: input["enabled"] }),
            },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      delete: (input: ScheduledTaskDeleteInput, requestOptions?: RequestOptions) =>
        request<ScheduledTaskDeleteOutput>(
          {
            schemaKey: '["api.scheduledTask","scheduledTask.delete"]',
            method: "DELETE",
            path: (params, wildcard) => `/api/scheduled-task/${encodeURIComponent(String(params["taskID"]))}`,
            params: { taskID: input["taskID"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            successStatus: 204,
            empty: true,
          },
          requestOptions,
        ),
      run: (input: ScheduledTaskRunInput, requestOptions?: RequestOptions) =>
        request<ScheduledTaskRunOutput>(
          {
            schemaKey: '["api.scheduledTask","scheduledTask.run"]',
            method: "POST",
            path: (params, wildcard) => `/api/scheduled-task/${encodeURIComponent(String(params["taskID"]))}/run`,
            params: { taskID: input["taskID"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            successStatus: 201,
            empty: false,
          },
          requestOptions,
        ),
      dismiss: (input: ScheduledTaskDismissInput, requestOptions?: RequestOptions) =>
        request<ScheduledTaskDismissOutput>(
          {
            schemaKey: '["api.scheduledTask","scheduledTask.dismiss"]',
            method: "POST",
            path: (params, wildcard) => `/api/scheduled-task/${encodeURIComponent(String(params["taskID"]))}/dismiss`,
            params: { taskID: input["taskID"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
    },
    skill: {
      list: (input?: SkillListInput, requestOptions?: RequestOptions) =>
        request<SkillListOutput>(
          {
            schemaKey: '["api.skill","skill.list"]',
            method: "GET",
            path: (params, wildcard) => `/api/skill`,
            query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      get: (input: SkillGetInput, requestOptions?: RequestOptions) =>
        request<SkillGetOutput>(
          {
            schemaKey: '["api.skill","skill.get"]',
            method: "GET",
            path: (params, wildcard) => `/api/skill/${encodeURIComponent(String(params["skillID"]))}`,
            params: { skillID: input["skillID"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      create: (input: SkillCreateInput, requestOptions?: RequestOptions) =>
        request<SkillCreateOutput>(
          {
            schemaKey: '["api.skill","skill.create"]',
            method: "POST",
            path: (params, wildcard) => `/api/skill`,
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: { name: input["name"], description: input["description"], instructions: input["instructions"] },
            successStatus: 201,
            empty: false,
          },
          requestOptions,
        ),
      update: (input: SkillUpdateInput, requestOptions?: RequestOptions) =>
        request<SkillUpdateOutput>(
          {
            schemaKey: '["api.skill","skill.update"]',
            method: "PUT",
            path: (params, wildcard) => `/api/skill/${encodeURIComponent(String(params["skillID"]))}`,
            params: { skillID: input["skillID"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: { name: input["name"], description: input["description"], instructions: input["instructions"] },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      delete: (input: SkillDeleteInput, requestOptions?: RequestOptions) =>
        request<SkillDeleteOutput>(
          {
            schemaKey: '["api.skill","skill.delete"]',
            method: "DELETE",
            path: (params, wildcard) => `/api/skill/${encodeURIComponent(String(params["skillID"]))}`,
            params: { skillID: input["skillID"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            successStatus: 204,
            empty: true,
          },
          requestOptions,
        ),
    },
    "api.policy": {
      list: (input?: ApiPolicyListInput, requestOptions?: RequestOptions) =>
        request<ApiPolicyListOutput>(
          {
            schemaKey: '["api.policy","policy.list"]',
            method: "GET",
            path: (params, wildcard) => `/api/policy`,
            query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      create: (input: ApiPolicyCreateInput, requestOptions?: RequestOptions) =>
        request<ApiPolicyCreateOutput>(
          {
            schemaKey: '["api.policy","policy.create"]',
            method: "POST",
            path: (params, wildcard) => `/api/policy`,
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: {
              id: input["id"],
              name: input["name"],
              ...(input["description"] === undefined ? {} : { description: input["description"] }),
              ...(input["enabled"] === undefined ? {} : { enabled: input["enabled"] }),
              rules: input["rules"],
            },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      update: (input: ApiPolicyUpdateInput, requestOptions?: RequestOptions) =>
        request<ApiPolicyUpdateOutput>(
          {
            schemaKey: '["api.policy","policy.update"]',
            method: "PUT",
            path: (params, wildcard) => `/api/policy/${encodeURIComponent(String(params["policyID"]))}`,
            params: { policyID: input["policyID"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: {
              id: input["id"],
              name: input["name"],
              ...(input["description"] === undefined ? {} : { description: input["description"] }),
              ...(input["enabled"] === undefined ? {} : { enabled: input["enabled"] }),
              rules: input["rules"],
            },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      delete: (input: ApiPolicyDeleteInput, requestOptions?: RequestOptions) =>
        request<ApiPolicyDeleteOutput>(
          {
            schemaKey: '["api.policy","policy.delete"]',
            method: "DELETE",
            path: (params, wildcard) => `/api/policy/${encodeURIComponent(String(params["policyID"]))}`,
            params: { policyID: input["policyID"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            successStatus: 204,
            empty: true,
          },
          requestOptions,
        ),
      setEnabled: (input: ApiPolicySetEnabledInput, requestOptions?: RequestOptions) =>
        request<ApiPolicySetEnabledOutput>(
          {
            schemaKey: '["api.policy","policy.setEnabled"]',
            method: "PUT",
            path: (params, wildcard) => `/api/policy/${encodeURIComponent(String(params["policyID"]))}/enabled`,
            params: { policyID: input["policyID"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: { enabled: input["enabled"] },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      validate: (input: ApiPolicyValidateInput, requestOptions?: RequestOptions) =>
        request<ApiPolicyValidateOutput>(
          {
            schemaKey: '["api.policy","policy.validate"]',
            method: "POST",
            path: (params, wildcard) => `/api/policy/validate`,
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: input["payload"],
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      simulate: (input: ApiPolicySimulateInput, requestOptions?: RequestOptions) =>
        request<ApiPolicySimulateOutput>(
          {
            schemaKey: '["api.policy","policy.simulate"]',
            method: "POST",
            path: (params, wildcard) => `/api/policy/simulate`,
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: { action: input["action"], resource: input["resource"] },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
    },
    command: {
      list: (input?: CommandListInput, requestOptions?: RequestOptions) =>
        request<CommandListOutput>(
          {
            schemaKey: '["api.command","command.list"]',
            method: "GET",
            path: (params, wildcard) => `/api/command`,
            query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
    },
    reference: {
      list: (input?: ReferenceListInput, requestOptions?: RequestOptions) =>
        request<ReferenceListOutput>(
          {
            schemaKey: '["api.reference","reference.list"]',
            method: "GET",
            path: (params, wildcard) => `/api/reference`,
            query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
    },
    usage: {
      list: (input?: UsageListInput, requestOptions?: RequestOptions) =>
        request<UsageListOutput>(
          {
            schemaKey: '["api.usage","usage.list"]',
            method: "GET",
            path: (params, wildcard) => `/api/usage`,
            query: {
              ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }),
              ...(input?.["cursor"] === undefined ? {} : { cursor: input?.["cursor"] }),
              ...(input?.["limit"] === undefined ? {} : { limit: input?.["limit"] }),
            },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      records: (input?: UsageRecordsInput, requestOptions?: RequestOptions) =>
        request<UsageRecordsOutput>(
          {
            schemaKey: '["api.usage","usage.records"]',
            method: "GET",
            path: (params, wildcard) => `/api/usage/records`,
            query: {
              ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }),
              ...(input?.["cursor"] === undefined ? {} : { cursor: input?.["cursor"] }),
              ...(input?.["limit"] === undefined ? {} : { limit: input?.["limit"] }),
            },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      overview: (input: UsageOverviewInput, requestOptions?: RequestOptions) =>
        request<UsageOverviewOutput>(
          {
            schemaKey: '["api.usage","usage.overview"]',
            method: "GET",
            path: (params, wildcard) => `/api/usage/overview`,
            query: {
              ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }),
              days: input["days"],
            },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      leaderboard: (input: UsageLeaderboardInput, requestOptions?: RequestOptions) =>
        request<UsageLeaderboardOutput>(
          {
            schemaKey: '["api.usage","usage.leaderboard"]',
            method: "GET",
            path: (params, wildcard) => `/api/usage/leaderboard`,
            query: {
              ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }),
              days: input["days"],
            },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
    },
    tool: {
      usage: {
        list: (input: ToolUsageListInput, requestOptions?: RequestOptions) =>
          request<ToolUsageListOutput>(
            {
              schemaKey: '["api.tool","tool.usage.list"]',
              method: "GET",
              path: (params, wildcard) => `/api/tool/usage`,
              query: {
                workspace: input["workspace"],
                ...(input["cursor"] === undefined ? {} : { cursor: input["cursor"] }),
                ...(input["limit"] === undefined ? {} : { limit: input["limit"] }),
                ...(input["userID"] === undefined ? {} : { userID: input["userID"] }),
                ...(input["sessionID"] === undefined ? {} : { sessionID: input["sessionID"] }),
              },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
      },
    },
    model: {
      list: (input?: ModelListInput, requestOptions?: RequestOptions) =>
        request<ModelListOutput>(
          {
            schemaKey: '["api.model","model.list"]',
            method: "GET",
            path: (params, wildcard) => `/api/models`,
            query: {
              ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }),
              ...(input?.["provider"] === undefined ? {} : { provider: input?.["provider"] }),
            },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      auto: (input?: ModelAutoInput, requestOptions?: RequestOptions) =>
        request<ModelAutoOutput>(
          {
            schemaKey: '["api.model","model.auto"]',
            method: "GET",
            path: (params, wildcard) => `/api/models/auto`,
            query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      route: (input: ModelRouteInput, requestOptions?: RequestOptions) =>
        request<ModelRouteOutput>(
          {
            schemaKey: '["api.model","model.route"]',
            method: "POST",
            path: (params, wildcard) => `/api/models/route`,
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: {
              model: input["model"],
              prompt: input["prompt"],
              ...(input["purpose"] === undefined ? {} : { purpose: input["purpose"] }),
            },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      toggle: (input: ModelToggleInput, requestOptions?: RequestOptions) =>
        request<ModelToggleOutput>(
          {
            schemaKey: '["api.model","model.toggle"]',
            method: "PUT",
            path: (params, wildcard) => `/api/models/toggle`,
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: { provider: input["provider"], id: input["id"], enabled: input["enabled"] },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      default: (input: ModelDefaultInput, requestOptions?: RequestOptions) =>
        request<ModelDefaultOutput>(
          {
            schemaKey: '["api.model","model.default"]',
            method: "PUT",
            path: (params, wildcard) => `/api/models/default`,
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: { provider: input["provider"], id: input["id"] },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      create: (input: ModelCreateInput, requestOptions?: RequestOptions) =>
        request<ModelCreateOutput>(
          {
            schemaKey: '["api.model","model.create"]',
            method: "POST",
            path: (params, wildcard) => `/api/models`,
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: {
              provider: input["provider"],
              ...(input["id"] === undefined ? {} : { id: input["id"] }),
              name: input["name"],
              apiID: input["apiID"],
              ...(input["cost"] === undefined ? {} : { cost: input["cost"] }),
              ...(input["limit"] === undefined ? {} : { limit: input["limit"] }),
            },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      update: (input: ModelUpdateInput, requestOptions?: RequestOptions) =>
        request<ModelUpdateOutput>(
          {
            schemaKey: '["api.model","model.update"]',
            method: "PUT",
            path: (params, wildcard) => `/api/models`,
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: {
              provider: input["provider"],
              id: input["id"],
              name: input["name"],
              apiID: input["apiID"],
              ...(input["cost"] === undefined ? {} : { cost: input["cost"] }),
              ...(input["limit"] === undefined ? {} : { limit: input["limit"] }),
            },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      delete: (input: ModelDeleteInput, requestOptions?: RequestOptions) =>
        request<ModelDeleteOutput>(
          {
            schemaKey: '["api.model","model.delete"]',
            method: "DELETE",
            path: (params, wildcard) => `/api/models`,
            query: {
              ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }),
              provider: input["provider"],
              id: input["id"],
            },
            successStatus: 204,
            empty: true,
          },
          requestOptions,
        ),
    },
    integration: {
      list: (input?: IntegrationListInput, requestOptions?: RequestOptions) =>
        request<IntegrationListOutput>(
          {
            schemaKey: '["api.integration","integration.list"]',
            method: "GET",
            path: (params, wildcard) => `/api/integration`,
            query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      get: (input: IntegrationGetInput, requestOptions?: RequestOptions) =>
        request<IntegrationGetOutput>(
          {
            schemaKey: '["api.integration","integration.get"]',
            method: "GET",
            path: (params, wildcard) => `/api/integration/${encodeURIComponent(String(params["integrationID"]))}`,
            params: { integrationID: input["integrationID"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      connect: {
        key: (input: IntegrationConnectKeyInput, requestOptions?: RequestOptions) =>
          request<IntegrationConnectKeyOutput>(
            {
              schemaKey: '["api.integration","integration.connect.key"]',
              method: "POST",
              path: (params, wildcard) =>
                `/api/integration/${encodeURIComponent(String(params["integrationID"]))}/connect/key`,
              params: { integrationID: input["integrationID"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              body: {
                key: input["key"],
                ...(input["label"] === undefined ? {} : { label: input["label"] }),
                ...(input["scope"] === undefined ? {} : { scope: input["scope"] }),
                ...(input["answer"] === undefined ? {} : { answer: input["answer"] }),
                ...(input["configuration"] === undefined ? {} : { configuration: input["configuration"] }),
              },
              successStatus: 204,
              empty: true,
            },
            requestOptions,
          ),
        values: (input: IntegrationConnectValuesInput, requestOptions?: RequestOptions) =>
          request<IntegrationConnectValuesOutput>(
            {
              schemaKey: '["api.integration","integration.connect.values"]',
              method: "POST",
              path: (params, wildcard) =>
                `/api/integration/${encodeURIComponent(String(params["integrationID"]))}/connect/values`,
              params: { integrationID: input["integrationID"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              body: { values: input["values"], ...(input["label"] === undefined ? {} : { label: input["label"] }) },
              successStatus: 204,
              empty: true,
            },
            requestOptions,
          ),
        awsSigV4: (input: IntegrationConnectAwsSigV4Input, requestOptions?: RequestOptions) =>
          request<IntegrationConnectAwsSigV4Output>(
            {
              schemaKey: '["api.integration","integration.connect.awsSigV4"]',
              method: "POST",
              path: (params, wildcard) =>
                `/api/integration/${encodeURIComponent(String(params["integrationID"]))}/connect/aws-sigv4`,
              params: { integrationID: input["integrationID"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              body: {
                accessKeyId: input["accessKeyId"],
                secretAccessKey: input["secretAccessKey"],
                ...(input["sessionToken"] === undefined ? {} : { sessionToken: input["sessionToken"] }),
                region: input["region"],
                ...(input["label"] === undefined ? {} : { label: input["label"] }),
                ...(input["scope"] === undefined ? {} : { scope: input["scope"] }),
                ...(input["methodID"] === undefined ? {} : { methodID: input["methodID"] }),
              },
              successStatus: 204,
              empty: true,
            },
            requestOptions,
          ),
      },
      oauth: {
        client: {
          put: (input: IntegrationOauthClientPutInput, requestOptions?: RequestOptions) =>
            request<IntegrationOauthClientPutOutput>(
              {
                schemaKey: '["api.integration","integration.oauth.client.put"]',
                method: "PUT",
                path: (params, wildcard) =>
                  `/api/integration/${encodeURIComponent(String(params["integrationID"]))}/oauth/${encodeURIComponent(String(params["methodID"]))}/client`,
                params: { integrationID: input["integrationID"], methodID: input["methodID"] },
                query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
                body: { answer: input["answer"] },
                successStatus: 204,
                empty: true,
              },
              requestOptions,
            ),
          remove: (input: IntegrationOauthClientRemoveInput, requestOptions?: RequestOptions) =>
            request<IntegrationOauthClientRemoveOutput>(
              {
                schemaKey: '["api.integration","integration.oauth.client.remove"]',
                method: "DELETE",
                path: (params, wildcard) =>
                  `/api/integration/${encodeURIComponent(String(params["integrationID"]))}/oauth/${encodeURIComponent(String(params["methodID"]))}/client`,
                params: { integrationID: input["integrationID"], methodID: input["methodID"] },
                query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
                successStatus: 204,
                empty: true,
              },
              requestOptions,
            ),
        },
        connect: (input: IntegrationOauthConnectInput, requestOptions?: RequestOptions) =>
          request<IntegrationOauthConnectOutput>(
            {
              schemaKey: '["api.integration","integration.oauth.connect"]',
              method: "POST",
              path: (params, wildcard) =>
                `/api/integration/${encodeURIComponent(String(params["integrationID"]))}/connect/oauth`,
              params: { integrationID: input["integrationID"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              body: {
                methodID: input["methodID"],
                ...(input["answer"] === undefined ? {} : { answer: input["answer"] }),
                ...(input["label"] === undefined ? {} : { label: input["label"] }),
                ...(input["scope"] === undefined ? {} : { scope: input["scope"] }),
              },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
        status: (input: IntegrationOauthStatusInput, requestOptions?: RequestOptions) =>
          request<IntegrationOauthStatusOutput>(
            {
              schemaKey: '["api.integration","integration.oauth.status"]',
              method: "GET",
              path: (params, wildcard) =>
                `/api/integration/${encodeURIComponent(String(params["integrationID"]))}/connect/oauth/${encodeURIComponent(String(params["attemptID"]))}`,
              params: { integrationID: input["integrationID"], attemptID: input["attemptID"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
        complete: (input: IntegrationOauthCompleteInput, requestOptions?: RequestOptions) =>
          request<IntegrationOauthCompleteOutput>(
            {
              schemaKey: '["api.integration","integration.oauth.complete"]',
              method: "POST",
              path: (params, wildcard) =>
                `/api/integration/${encodeURIComponent(String(params["integrationID"]))}/connect/oauth/${encodeURIComponent(String(params["attemptID"]))}/complete`,
              params: { integrationID: input["integrationID"], attemptID: input["attemptID"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              body: { ...(input["code"] === undefined ? {} : { code: input["code"] }) },
              successStatus: 204,
              empty: true,
            },
            requestOptions,
          ),
        cancel: (input: IntegrationOauthCancelInput, requestOptions?: RequestOptions) =>
          request<IntegrationOauthCancelOutput>(
            {
              schemaKey: '["api.integration","integration.oauth.cancel"]',
              method: "DELETE",
              path: (params, wildcard) =>
                `/api/integration/${encodeURIComponent(String(params["integrationID"]))}/connect/oauth/${encodeURIComponent(String(params["attemptID"]))}`,
              params: { integrationID: input["integrationID"], attemptID: input["attemptID"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              successStatus: 204,
              empty: true,
            },
            requestOptions,
          ),
      },
      command: {
        connect: (input: IntegrationCommandConnectInput, requestOptions?: RequestOptions) =>
          request<IntegrationCommandConnectOutput>(
            {
              schemaKey: '["api.integration","integration.command.connect"]',
              method: "POST",
              path: (params, wildcard) =>
                `/api/integration/${encodeURIComponent(String(params["integrationID"]))}/connect/command`,
              params: { integrationID: input["integrationID"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              body: {
                methodID: input["methodID"],
                ...(input["label"] === undefined ? {} : { label: input["label"] }),
                ...(input["scope"] === undefined ? {} : { scope: input["scope"] }),
              },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
        status: (input: IntegrationCommandStatusInput, requestOptions?: RequestOptions) =>
          request<IntegrationCommandStatusOutput>(
            {
              schemaKey: '["api.integration","integration.command.status"]',
              method: "GET",
              path: (params, wildcard) =>
                `/api/integration/${encodeURIComponent(String(params["integrationID"]))}/connect/command/${encodeURIComponent(String(params["attemptID"]))}`,
              params: { integrationID: input["integrationID"], attemptID: input["attemptID"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
        cancel: (input: IntegrationCommandCancelInput, requestOptions?: RequestOptions) =>
          request<IntegrationCommandCancelOutput>(
            {
              schemaKey: '["api.integration","integration.command.cancel"]',
              method: "DELETE",
              path: (params, wildcard) =>
                `/api/integration/${encodeURIComponent(String(params["integrationID"]))}/connect/command/${encodeURIComponent(String(params["attemptID"]))}`,
              params: { integrationID: input["integrationID"], attemptID: input["attemptID"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              successStatus: 204,
              empty: true,
            },
            requestOptions,
          ),
      },
    },
    mcp: {
      servers: {
        update: (input: McpServersUpdateInput, requestOptions?: RequestOptions) =>
          request<McpServersUpdateOutput>(
            {
              schemaKey: '["api.mcp","mcp.servers.update"]',
              method: "PUT",
              path: (params, wildcard) => `/api/mcp/server/${encodeURIComponent(String(params["server"]))}/activation`,
              params: { server: input["server"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              body: { enabled: input["enabled"] },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
        list: (input?: McpServersListInput, requestOptions?: RequestOptions) =>
          request<McpServersListOutput>(
            {
              schemaKey: '["api.mcp","mcp.servers.list"]',
              method: "GET",
              path: (params, wildcard) => `/api/mcp/server`,
              query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
        put: (input: McpServersPutInput, requestOptions?: RequestOptions) =>
          request<McpServersPutOutput>(
            {
              schemaKey: '["api.mcp","mcp.servers.put"]',
              method: "PUT",
              path: (params, wildcard) => `/api/mcp/server/${encodeURIComponent(String(params["server"]))}`,
              params: { server: input["server"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              body: {
                url: input["url"],
                ...(input["oauth"] === undefined ? {} : { oauth: input["oauth"] }),
                ...(input["codemode"] === undefined ? {} : { codemode: input["codemode"] }),
                ...(input["disabled"] === undefined ? {} : { disabled: input["disabled"] }),
                ...(input["headers"] === undefined ? {} : { headers: input["headers"] }),
              },
              successStatus: 200,
              empty: true,
            },
            requestOptions,
          ),
        remove: (input: McpServersRemoveInput, requestOptions?: RequestOptions) =>
          request<McpServersRemoveOutput>(
            {
              schemaKey: '["api.mcp","mcp.servers.remove"]',
              method: "DELETE",
              path: (params, wildcard) => `/api/mcp/server/${encodeURIComponent(String(params["server"]))}`,
              params: { server: input["server"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              successStatus: 200,
              empty: true,
            },
            requestOptions,
          ),
        members: (input: McpServersMembersInput, requestOptions?: RequestOptions) =>
          request<McpServersMembersOutput>(
            {
              schemaKey: '["api.mcp","mcp.servers.members"]',
              method: "GET",
              path: (params, wildcard) => `/api/mcp/server/${encodeURIComponent(String(params["server"]))}/member`,
              params: { server: input["server"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
        connect: (input: McpServersConnectInput, requestOptions?: RequestOptions) =>
          request<McpServersConnectOutput>(
            {
              schemaKey: '["api.mcp","mcp.servers.connect"]',
              method: "POST",
              path: (params, wildcard) => `/api/mcp/server/${encodeURIComponent(String(params["server"]))}/connect`,
              params: { server: input["server"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              body: input["payload"],
              successStatus: 200,
              empty: true,
            },
            requestOptions,
          ),
        disconnect: (input: McpServersDisconnectInput, requestOptions?: RequestOptions) =>
          request<McpServersDisconnectOutput>(
            {
              schemaKey: '["api.mcp","mcp.servers.disconnect"]',
              method: "POST",
              path: (params, wildcard) => `/api/mcp/server/${encodeURIComponent(String(params["server"]))}/disconnect`,
              params: { server: input["server"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              body: input["payload"],
              successStatus: 200,
              empty: true,
            },
            requestOptions,
          ),
        test: (input: McpServersTestInput, requestOptions?: RequestOptions) =>
          request<McpServersTestOutput>(
            {
              schemaKey: '["api.mcp","mcp.servers.test"]',
              method: "POST",
              path: (params, wildcard) => `/api/mcp/server/${encodeURIComponent(String(params["server"]))}/test`,
              params: { server: input["server"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              body: input["payload"],
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
      },
      tools: {
        list: (input?: McpToolsListInput, requestOptions?: RequestOptions) =>
          request<McpToolsListOutput>(
            {
              schemaKey: '["api.mcp","mcp.tools.list"]',
              method: "GET",
              path: (params, wildcard) => `/api/mcp/tool`,
              query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
      },
    },
    credential: {
      update: (input: CredentialUpdateInput, requestOptions?: RequestOptions) =>
        request<CredentialUpdateOutput>(
          {
            schemaKey: '["api.credential","credential.update"]',
            method: "PATCH",
            path: (params, wildcard) => `/api/credential/${encodeURIComponent(String(params["credentialID"]))}`,
            params: { credentialID: input["credentialID"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: { label: input["label"] },
            successStatus: 204,
            empty: true,
          },
          requestOptions,
        ),
      activate: (input: CredentialActivateInput, requestOptions?: RequestOptions) =>
        request<CredentialActivateOutput>(
          {
            schemaKey: '["api.credential","credential.activate"]',
            method: "POST",
            path: (params, wildcard) =>
              `/api/credential/${encodeURIComponent(String(params["credentialID"]))}/activate`,
            params: { credentialID: input["credentialID"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            successStatus: 204,
            empty: true,
          },
          requestOptions,
        ),
      remove: (input: CredentialRemoveInput, requestOptions?: RequestOptions) =>
        request<CredentialRemoveOutput>(
          {
            schemaKey: '["api.credential","credential.remove"]',
            method: "DELETE",
            path: (params, wildcard) => `/api/credential/${encodeURIComponent(String(params["credentialID"]))}`,
            params: { credentialID: input["credentialID"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            successStatus: 204,
            empty: true,
          },
          requestOptions,
        ),
    },
    websearch: {
      providers: (input?: WebsearchProvidersInput, requestOptions?: RequestOptions) =>
        request<WebsearchProvidersOutput>(
          {
            schemaKey: '["api.websearch","websearch.providers"]',
            method: "GET",
            path: (params, wildcard) => `/api/websearch/provider`,
            query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      query: (input: WebsearchQueryInput, requestOptions?: RequestOptions) =>
        request<WebsearchQueryOutput>(
          {
            schemaKey: '["api.websearch","websearch.query"]',
            method: "POST",
            path: (params, wildcard) => `/api/websearch`,
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: {
              query: input["query"],
              ...(input["providerID"] === undefined ? {} : { providerID: input["providerID"] }),
            },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
    },
    session: {
      create: (input: SessionCreateInput, requestOptions?: RequestOptions) =>
        request<SessionCreateOutput>(
          {
            schemaKey: '["api.session","session.create"]',
            method: "POST",
            path: (params, wildcard) => `/api/session`,
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: {
              projectID: input["projectID"],
              ...(input["agent"] === undefined ? {} : { agent: input["agent"] }),
              ...(input["model"] === undefined ? {} : { model: input["model"] }),
            },
            successStatus: 201,
            empty: false,
          },
          requestOptions,
        ),
      list: (input?: SessionListInput, requestOptions?: RequestOptions) =>
        request<SessionListOutput>(
          {
            schemaKey: '["api.session","session.list"]',
            method: "GET",
            path: (params, wildcard) => `/api/session`,
            query: {
              ...(input?.["cursor"] === undefined ? {} : { cursor: input?.["cursor"] }),
              ...(input?.["limit"] === undefined ? {} : { limit: input?.["limit"] }),
              ...(input?.["search"] === undefined ? {} : { search: input?.["search"] }),
              ...(input?.["parentID"] === undefined ? {} : { parentID: input?.["parentID"] }),
              ...(input?.["archived"] === undefined ? {} : { archived: input?.["archived"] }),
              ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }),
            },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      active: (input?: SessionActiveInput, requestOptions?: RequestOptions) =>
        request<SessionActiveOutput>(
          {
            schemaKey: '["api.session","session.active"]',
            method: "GET",
            path: (params, wildcard) => `/api/session/active`,
            query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      get: (input: SessionGetInput, requestOptions?: RequestOptions) =>
        request<SessionGetOutput>(
          {
            schemaKey: '["api.session","session.get"]',
            method: "GET",
            path: (params, wildcard) => `/api/session/${encodeURIComponent(String(params["sessionID"]))}`,
            params: { sessionID: input["sessionID"] },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      update: (input: SessionUpdateInput, requestOptions?: RequestOptions) =>
        request<SessionUpdateOutput>(
          {
            schemaKey: '["api.session","session.update"]',
            method: "PATCH",
            path: (params, wildcard) => `/api/session/${encodeURIComponent(String(params["sessionID"]))}`,
            params: { sessionID: input["sessionID"] },
            body: {
              ...(input["title"] === undefined ? {} : { title: input["title"] }),
              ...(input["projectID"] === undefined ? {} : { projectID: input["projectID"] }),
              ...(input["archived"] === undefined ? {} : { archived: input["archived"] }),
            },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      delete: (input: SessionDeleteInput, requestOptions?: RequestOptions) =>
        request<SessionDeleteOutput>(
          {
            schemaKey: '["api.session","session.delete"]',
            method: "DELETE",
            path: (params, wildcard) => `/api/session/${encodeURIComponent(String(params["sessionID"]))}`,
            params: { sessionID: input["sessionID"] },
            successStatus: 204,
            empty: true,
          },
          requestOptions,
        ),
      inbox: {
        list: (input: SessionInboxListInput, requestOptions?: RequestOptions) =>
          request<{ readonly data: SessionInboxListOutput }>(
            {
              schemaKey: '["api.session","session.inbox.list"]',
              method: "GET",
              path: (params, wildcard) => `/api/session/${encodeURIComponent(String(params["sessionID"]))}/inbox`,
              params: { sessionID: input["sessionID"] },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ).then((value) => value.data),
      },
      prompt: (input: SessionPromptInput, requestOptions?: RequestOptions) =>
        request<SessionPromptOutput>(
          {
            schemaKey: '["api.session","session.prompt"]',
            method: "POST",
            path: (params, wildcard) => `/api/session/${encodeURIComponent(String(params["sessionID"]))}/prompt`,
            params: { sessionID: input["sessionID"] },
            body: {
              ...(input["id"] === undefined ? {} : { id: input["id"] }),
              text: input["text"],
              ...(input["agents"] === undefined ? {} : { agents: input["agents"] }),
              ...(input["metadata"] === undefined ? {} : { metadata: input["metadata"] }),
              ...(input["delivery"] === undefined ? {} : { delivery: input["delivery"] }),
              ...(input["resume"] === undefined ? {} : { resume: input["resume"] }),
            },
            successStatus: 202,
            empty: false,
          },
          requestOptions,
        ),
      compact: (input: SessionCompactInput, requestOptions?: RequestOptions) =>
        request<SessionCompactOutput>(
          {
            schemaKey: '["api.session","session.compact"]',
            method: "POST",
            path: (params, wildcard) => `/api/session/${encodeURIComponent(String(params["sessionID"]))}/compact`,
            params: { sessionID: input["sessionID"] },
            body: { ...(input["id"] === undefined ? {} : { id: input["id"] }) },
            successStatus: 202,
            empty: false,
          },
          requestOptions,
        ),
      interrupt: (input: SessionInterruptInput, requestOptions?: RequestOptions) =>
        request<SessionInterruptOutput>(
          {
            schemaKey: '["api.session","session.interrupt"]',
            method: "POST",
            path: (params, wildcard) => `/api/session/${encodeURIComponent(String(params["sessionID"]))}/interrupt`,
            params: { sessionID: input["sessionID"] },
            body: input["payload"],
            successStatus: 204,
            empty: true,
          },
          requestOptions,
        ),
      background: (input: SessionBackgroundInput, requestOptions?: RequestOptions) =>
        request<SessionBackgroundOutput>(
          {
            schemaKey: '["api.session","session.background"]',
            method: "POST",
            path: (params, wildcard) => `/api/session/${encodeURIComponent(String(params["sessionID"]))}/background`,
            params: { sessionID: input["sessionID"] },
            successStatus: 204,
            empty: true,
          },
          requestOptions,
        ),
      switchAgent: (input: SessionSwitchAgentInput, requestOptions?: RequestOptions) =>
        request<SessionSwitchAgentOutput>(
          {
            schemaKey: '["api.session","session.switchAgent"]',
            method: "POST",
            path: (params, wildcard) => `/api/session/${encodeURIComponent(String(params["sessionID"]))}/agent`,
            params: { sessionID: input["sessionID"] },
            body: { agent: input["agent"] },
            successStatus: 204,
            empty: true,
          },
          requestOptions,
        ),
      switchModel: (input: SessionSwitchModelInput, requestOptions?: RequestOptions) =>
        request<SessionSwitchModelOutput>(
          {
            schemaKey: '["api.session","session.switchModel"]',
            method: "POST",
            path: (params, wildcard) => `/api/session/${encodeURIComponent(String(params["sessionID"]))}/model`,
            params: { sessionID: input["sessionID"] },
            body: { model: input["model"] },
            successStatus: 204,
            empty: true,
          },
          requestOptions,
        ),
      rename: (input: SessionRenameInput, requestOptions?: RequestOptions) =>
        request<SessionRenameOutput>(
          {
            schemaKey: '["api.session","session.rename"]',
            method: "POST",
            path: (params, wildcard) => `/api/session/${encodeURIComponent(String(params["sessionID"]))}/rename`,
            params: { sessionID: input["sessionID"] },
            body: { title: input["title"] },
            successStatus: 204,
            empty: true,
          },
          requestOptions,
        ),
      command: (input: SessionCommandInput, requestOptions?: RequestOptions) =>
        request<SessionCommandOutput>(
          {
            schemaKey: '["api.session","session.command"]',
            method: "POST",
            path: (params, wildcard) => `/api/session/${encodeURIComponent(String(params["sessionID"]))}/command`,
            params: { sessionID: input["sessionID"] },
            body: {
              ...(input["id"] === undefined ? {} : { id: input["id"] }),
              command: input["command"],
              ...(input["arguments"] === undefined ? {} : { arguments: input["arguments"] }),
            },
            successStatus: 202,
            empty: false,
          },
          requestOptions,
        ),
      synthetic: (input: SessionSyntheticInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionSyntheticOutput }>(
          {
            schemaKey: '["api.session","session.synthetic"]',
            method: "POST",
            path: (params, wildcard) => `/api/session/${encodeURIComponent(String(params["sessionID"]))}/synthetic`,
            params: { sessionID: input["sessionID"] },
            body: {
              ...(input["id"] === undefined ? {} : { id: input["id"] }),
              text: input["text"],
              ...(input["description"] === undefined ? {} : { description: input["description"] }),
              ...(input["metadata"] === undefined ? {} : { metadata: input["metadata"] }),
              ...(input["delivery"] === undefined ? {} : { delivery: input["delivery"] }),
              ...(input["resume"] === undefined ? {} : { resume: input["resume"] }),
            },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      wait: (input: SessionWaitInput, requestOptions?: RequestOptions) =>
        request<SessionWaitOutput>(
          {
            schemaKey: '["api.session","session.wait"]',
            method: "POST",
            path: (params, wildcard) => `/api/session/${encodeURIComponent(String(params["sessionID"]))}/wait`,
            params: { sessionID: input["sessionID"] },
            successStatus: 204,
            empty: true,
          },
          requestOptions,
        ),
      generate: (input: SessionGenerateInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionGenerateOutput }>(
          {
            schemaKey: '["api.session","session.generate"]',
            method: "POST",
            path: (params, wildcard) => `/api/session/${encodeURIComponent(String(params["sessionID"]))}/generate`,
            params: { sessionID: input["sessionID"] },
            body: { prompt: input["prompt"] },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      entry: {
        list: (input: SessionEntryListInput, requestOptions?: RequestOptions) =>
          request<{ readonly data: SessionEntryListOutput }>(
            {
              schemaKey: '["api.session","session.entry.list"]',
              method: "GET",
              path: (params, wildcard) =>
                `/api/session/${encodeURIComponent(String(params["sessionID"]))}/instructions/entries`,
              params: { sessionID: input["sessionID"] },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ).then((value) => value.data),
        put: (input: SessionEntryPutInput, requestOptions?: RequestOptions) =>
          request<SessionEntryPutOutput>(
            {
              schemaKey: '["api.session","session.entry.put"]',
              method: "PUT",
              path: (params, wildcard) =>
                `/api/session/${encodeURIComponent(String(params["sessionID"]))}/instructions/entries/${encodeURIComponent(String(params["key"]))}`,
              params: { sessionID: input["sessionID"], key: input["key"] },
              body: { value: input["value"] },
              successStatus: 204,
              empty: true,
            },
            requestOptions,
          ),
        remove: (input: SessionEntryRemoveInput, requestOptions?: RequestOptions) =>
          request<SessionEntryRemoveOutput>(
            {
              schemaKey: '["api.session","session.entry.remove"]',
              method: "DELETE",
              path: (params, wildcard) =>
                `/api/session/${encodeURIComponent(String(params["sessionID"]))}/instructions/entries/${encodeURIComponent(String(params["key"]))}`,
              params: { sessionID: input["sessionID"], key: input["key"] },
              successStatus: 204,
              empty: true,
            },
            requestOptions,
          ),
      },
    },
    message: {
      list: (input: MessageListInput, requestOptions?: RequestOptions) =>
        request<MessageListOutput>(
          {
            schemaKey: '["api.message","message.list"]',
            method: "GET",
            path: (params, wildcard) => `/api/session/${encodeURIComponent(String(params["sessionID"]))}/message`,
            params: { sessionID: input["sessionID"] },
            query: {
              ...(input["limit"] === undefined ? {} : { limit: input["limit"] }),
              ...(input["order"] === undefined ? {} : { order: input["order"] }),
              ...(input["cursor"] === undefined ? {} : { cursor: input["cursor"] }),
            },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
    },
    event: {
      subscribe: (input?: EventSubscribeInput, requestOptions?: RequestOptions): AsyncIterable<EventSubscribeOutput> =>
        sse<EventSubscribeOutput>(
          {
            schemaKey: '["api.event","event.subscribe"]',
            method: "GET",
            path: (params, wildcard) => `/api/event`,
            query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
    },
    agent: {
      list: (input?: AgentListInput, requestOptions?: RequestOptions) =>
        request<AgentListOutput>(
          {
            schemaKey: '["api.agent","agent.list"]',
            method: "GET",
            path: (params, wildcard) => `/api/agent`,
            query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      get: (input: AgentGetInput, requestOptions?: RequestOptions) =>
        request<AgentGetOutput>(
          {
            schemaKey: '["api.agent","agent.get"]',
            method: "GET",
            path: (params, wildcard) => `/api/agent/${encodeURIComponent(String(params["id"]))}`,
            params: { id: input["id"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      create: (input: AgentCreateInput, requestOptions?: RequestOptions) =>
        request<AgentCreateOutput>(
          {
            schemaKey: '["api.agent","agent.create"]',
            method: "POST",
            path: (params, wildcard) => `/api/agent`,
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: {
              id: input["id"],
              name: input["name"],
              instructions: input["instructions"],
              ...(input["model"] === undefined ? {} : { model: input["model"] }),
              ...(input["description"] === undefined ? {} : { description: input["description"] }),
              mode: input["mode"],
              hidden: input["hidden"],
              ...(input["color"] === undefined ? {} : { color: input["color"] }),
              steps: input["steps"],
              permissions: input["permissions"],
              ...(input["overridden"] === undefined ? {} : { overridden: input["overridden"] }),
            },
            successStatus: 201,
            empty: false,
          },
          requestOptions,
        ),
      update: (input: AgentUpdateInput, requestOptions?: RequestOptions) =>
        request<AgentUpdateOutput>(
          {
            schemaKey: '["api.agent","agent.update"]',
            method: "PUT",
            path: (params, wildcard) => `/api/agent/${encodeURIComponent(String(params["id"]))}`,
            params: { id: input["id"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: {
              name: input["name"],
              instructions: input["instructions"],
              ...(input["model"] === undefined ? {} : { model: input["model"] }),
              ...(input["description"] === undefined ? {} : { description: input["description"] }),
              mode: input["mode"],
              hidden: input["hidden"],
              ...(input["color"] === undefined ? {} : { color: input["color"] }),
              steps: input["steps"],
              permissions: input["permissions"],
            },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      delete: (input: AgentDeleteInput, requestOptions?: RequestOptions) =>
        request<AgentDeleteOutput>(
          {
            schemaKey: '["api.agent","agent.delete"]',
            method: "DELETE",
            path: (params, wildcard) => `/api/agent/${encodeURIComponent(String(params["id"]))}`,
            params: { id: input["id"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            successStatus: 204,
            empty: true,
          },
          requestOptions,
        ),
    },
    "api.audit": {
      list: (input?: ApiAuditListInput, requestOptions?: RequestOptions) =>
        request<ApiAuditListOutput>(
          {
            schemaKey: '["api.audit","audit.list"]',
            method: "GET",
            path: (params, wildcard) => `/api/audit`,
            query: {
              ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }),
              ...(input?.["from"] === undefined ? {} : { from: input?.["from"] }),
              ...(input?.["to"] === undefined ? {} : { to: input?.["to"] }),
              ...(input?.["actor"] === undefined ? {} : { actor: input?.["actor"] }),
              ...(input?.["action"] === undefined ? {} : { action: input?.["action"] }),
              ...(input?.["target"] === undefined ? {} : { target: input?.["target"] }),
              ...(input?.["cursor"] === undefined ? {} : { cursor: input?.["cursor"] }),
              ...(input?.["limit"] === undefined ? {} : { limit: input?.["limit"] }),
            },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
    },
    serviceAccount: {
      list: (input?: ServiceAccountListInput, requestOptions?: RequestOptions) =>
        request<ServiceAccountListOutput>(
          {
            schemaKey: '["api.service-account","service-account.list"]',
            method: "GET",
            path: (params, wildcard) => `/api/service-account`,
            query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      create: (input: ServiceAccountCreateInput, requestOptions?: RequestOptions) =>
        request<ServiceAccountCreateOutput>(
          {
            schemaKey: '["api.service-account","service-account.create"]',
            method: "POST",
            path: (params, wildcard) => `/api/service-account`,
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: { name: input["name"], ...(input["policy"] === undefined ? {} : { policy: input["policy"] }) },
            successStatus: 201,
            empty: false,
          },
          requestOptions,
        ),
      get: (input: ServiceAccountGetInput, requestOptions?: RequestOptions) =>
        request<ServiceAccountGetOutput>(
          {
            schemaKey: '["api.service-account","service-account.get"]',
            method: "GET",
            path: (params, wildcard) => `/api/service-account/${encodeURIComponent(String(params["id"]))}`,
            params: { id: input["id"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      update: (input: ServiceAccountUpdateInput, requestOptions?: RequestOptions) =>
        request<ServiceAccountUpdateOutput>(
          {
            schemaKey: '["api.service-account","service-account.update"]',
            method: "PATCH",
            path: (params, wildcard) => `/api/service-account/${encodeURIComponent(String(params["id"]))}`,
            params: { id: input["id"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: {
              ...(input["name"] === undefined ? {} : { name: input["name"] }),
              ...(input["policy"] === undefined ? {} : { policy: input["policy"] }),
              ...(input["status"] === undefined ? {} : { status: input["status"] }),
            },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: ServiceAccountRemoveInput, requestOptions?: RequestOptions) =>
        request<ServiceAccountRemoveOutput>(
          {
            schemaKey: '["api.service-account","service-account.remove"]',
            method: "DELETE",
            path: (params, wildcard) => `/api/service-account/${encodeURIComponent(String(params["id"]))}`,
            params: { id: input["id"] },
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            successStatus: 204,
            empty: true,
          },
          requestOptions,
        ),
      key: {
        list: (input: ServiceAccountKeyListInput, requestOptions?: RequestOptions) =>
          request<ServiceAccountKeyListOutput>(
            {
              schemaKey: '["api.service-account","service-account.key.list"]',
              method: "GET",
              path: (params, wildcard) => `/api/service-account/${encodeURIComponent(String(params["id"]))}/key`,
              params: { id: input["id"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
        create: (input: ServiceAccountKeyCreateInput, requestOptions?: RequestOptions) =>
          request<ServiceAccountKeyCreateOutput>(
            {
              schemaKey: '["api.service-account","service-account.key.create"]',
              method: "POST",
              path: (params, wildcard) => `/api/service-account/${encodeURIComponent(String(params["id"]))}/key`,
              params: { id: input["id"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              body: {
                name: input["name"],
                ...(input["timeExpires"] === undefined ? {} : { timeExpires: input["timeExpires"] }),
              },
              successStatus: 201,
              empty: false,
            },
            requestOptions,
          ),
        revoke: (input: ServiceAccountKeyRevokeInput, requestOptions?: RequestOptions) =>
          request<ServiceAccountKeyRevokeOutput>(
            {
              schemaKey: '["api.service-account","service-account.key.revoke"]',
              method: "DELETE",
              path: (params, wildcard) =>
                `/api/service-account/${encodeURIComponent(String(params["id"]))}/key/${encodeURIComponent(String(params["keyID"]))}`,
              params: { id: input["id"], keyID: input["keyID"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              successStatus: 204,
              empty: true,
            },
            requestOptions,
          ),
      },
    },
    budget: {
      status: (input?: BudgetStatusInput, requestOptions?: RequestOptions) =>
        request<BudgetStatusOutput>(
          {
            schemaKey: '["api.budget","budget.status"]',
            method: "GET",
            path: (params, wildcard) => `/api/budget`,
            query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      limit: (input: BudgetLimitInput, requestOptions?: RequestOptions) =>
        request<BudgetLimitOutput>(
          {
            schemaKey: '["api.budget","budget.limit"]',
            method: "PUT",
            path: (params, wildcard) => `/api/budget/limit`,
            query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
            body: { target: input["target"], ...(input["amount"] === undefined ? {} : { amount: input["amount"] }) },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
    },
    permission: {
      request: {
        list: (input?: PermissionRequestListInput, requestOptions?: RequestOptions) =>
          request<PermissionRequestListOutput>(
            {
              schemaKey: '["api.permission","permission.request.list"]',
              method: "GET",
              path: (params, wildcard) => `/api/permission/request`,
              query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
      },
      saved: {
        list: (input?: PermissionSavedListInput, requestOptions?: RequestOptions) =>
          request<PermissionSavedListOutput>(
            {
              schemaKey: '["api.permission","permission.saved.list"]',
              method: "GET",
              path: (params, wildcard) => `/api/permission/saved`,
              query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
        remove: (input: PermissionSavedRemoveInput, requestOptions?: RequestOptions) =>
          request<PermissionSavedRemoveOutput>(
            {
              schemaKey: '["api.permission","permission.saved.remove"]',
              method: "DELETE",
              path: (params, wildcard) => `/api/permission/saved/${encodeURIComponent(String(params["savedID"]))}`,
              params: { savedID: input["savedID"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              successStatus: 204,
              empty: true,
            },
            requestOptions,
          ),
      },
      tools: {
        list: (input?: PermissionToolsListInput, requestOptions?: RequestOptions) =>
          request<PermissionToolsListOutput>(
            {
              schemaKey: '["api.permission","permission.tools.list"]',
              method: "GET",
              path: (params, wildcard) => `/api/permission/tool`,
              query: {
                ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }),
                ...(input?.["user"] === undefined ? {} : { user: input?.["user"] }),
              },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
        update: (input: PermissionToolsUpdateInput, requestOptions?: RequestOptions) =>
          request<PermissionToolsUpdateOutput>(
            {
              schemaKey: '["api.permission","permission.tools.update"]',
              method: "PUT",
              path: (params, wildcard) => `/api/permission/tool`,
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              body: { ...(input["user"] === undefined ? {} : { user: input["user"] }), tools: input["tools"] },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
      },
      create: (input: PermissionCreateInput, requestOptions?: RequestOptions) =>
        request<PermissionCreateOutput>(
          {
            schemaKey: '["api.permission","session.permission.create"]',
            method: "POST",
            path: (params, wildcard) => `/api/session/${encodeURIComponent(String(params["sessionID"]))}/permission`,
            params: { sessionID: input["sessionID"] },
            body: {
              ...(input["id"] === undefined ? {} : { id: input["id"] }),
              action: input["action"],
              resources: input["resources"],
              ...(input["save"] === undefined ? {} : { save: input["save"] }),
              ...(input["metadata"] === undefined ? {} : { metadata: input["metadata"] }),
              ...(input["source"] === undefined ? {} : { source: input["source"] }),
              ...(input["agent"] === undefined ? {} : { agent: input["agent"] }),
            },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      list: (input: PermissionListInput, requestOptions?: RequestOptions) =>
        request<PermissionListOutput>(
          {
            schemaKey: '["api.permission","session.permission.list"]',
            method: "GET",
            path: (params, wildcard) => `/api/session/${encodeURIComponent(String(params["sessionID"]))}/permission`,
            params: { sessionID: input["sessionID"] },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      get: (input: PermissionGetInput, requestOptions?: RequestOptions) =>
        request<PermissionGetOutput>(
          {
            schemaKey: '["api.permission","session.permission.get"]',
            method: "GET",
            path: (params, wildcard) =>
              `/api/session/${encodeURIComponent(String(params["sessionID"]))}/permission/${encodeURIComponent(String(params["requestID"]))}`,
            params: { sessionID: input["sessionID"], requestID: input["requestID"] },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      reply: (input: PermissionReplyInput, requestOptions?: RequestOptions) =>
        request<PermissionReplyOutput>(
          {
            schemaKey: '["api.permission","session.permission.reply"]',
            method: "POST",
            path: (params, wildcard) =>
              `/api/session/${encodeURIComponent(String(params["sessionID"]))}/permission/${encodeURIComponent(String(params["requestID"]))}/reply`,
            params: { sessionID: input["sessionID"], requestID: input["requestID"] },
            body: { reply: input["reply"], ...(input["message"] === undefined ? {} : { message: input["message"] }) },
            successStatus: 204,
            empty: true,
          },
          requestOptions,
        ),
    },
    form: {
      request: {
        list: (input?: FormRequestListInput, requestOptions?: RequestOptions) =>
          request<FormRequestListOutput>(
            {
              schemaKey: '["api.form","form.request.list"]',
              method: "GET",
              path: (params, wildcard) => `/api/form/request`,
              query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
      },
      caller: {
        list: (input?: FormCallerListInput, requestOptions?: RequestOptions) =>
          request<FormCallerListOutput>(
            {
              schemaKey: '["api.form","form.caller.list"]',
              method: "GET",
              path: (params, wildcard) => `/api/form`,
              query: { ...(input?.["workspace"] === undefined ? {} : { workspace: input?.["workspace"] }) },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
        get: (input: FormCallerGetInput, requestOptions?: RequestOptions) =>
          request<FormCallerGetOutput>(
            {
              schemaKey: '["api.form","form.caller.get"]',
              method: "GET",
              path: (params, wildcard) => `/api/form/${encodeURIComponent(String(params["formID"]))}`,
              params: { formID: input["formID"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
        state: (input: FormCallerStateInput, requestOptions?: RequestOptions) =>
          request<FormCallerStateOutput>(
            {
              schemaKey: '["api.form","form.caller.state"]',
              method: "GET",
              path: (params, wildcard) => `/api/form/${encodeURIComponent(String(params["formID"]))}/state`,
              params: { formID: input["formID"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              successStatus: 200,
              empty: false,
            },
            requestOptions,
          ),
        reply: (input: FormCallerReplyInput, requestOptions?: RequestOptions) =>
          request<FormCallerReplyOutput>(
            {
              schemaKey: '["api.form","form.caller.reply"]',
              method: "POST",
              path: (params, wildcard) => `/api/form/${encodeURIComponent(String(params["formID"]))}/reply`,
              params: { formID: input["formID"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              body: { answer: input["answer"] },
              successStatus: 204,
              empty: true,
            },
            requestOptions,
          ),
        cancel: (input: FormCallerCancelInput, requestOptions?: RequestOptions) =>
          request<FormCallerCancelOutput>(
            {
              schemaKey: '["api.form","form.caller.cancel"]',
              method: "POST",
              path: (params, wildcard) => `/api/form/${encodeURIComponent(String(params["formID"]))}/cancel`,
              params: { formID: input["formID"] },
              query: { ...(input["workspace"] === undefined ? {} : { workspace: input["workspace"] }) },
              successStatus: 204,
              empty: true,
            },
            requestOptions,
          ),
      },
      list: (input: FormListInput, requestOptions?: RequestOptions) =>
        request<FormListOutput>(
          {
            schemaKey: '["api.form","session.form.list"]',
            method: "GET",
            path: (params, wildcard) => `/api/session/${encodeURIComponent(String(params["sessionID"]))}/form`,
            params: { sessionID: input["sessionID"] },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      create: (input: FormCreateInput, requestOptions?: RequestOptions) =>
        request<FormCreateOutput>(
          {
            schemaKey: '["api.form","session.form.create"]',
            method: "POST",
            path: (params, wildcard) => `/api/session/${encodeURIComponent(String(params["sessionID"]))}/form`,
            params: { sessionID: input["sessionID"] },
            body: {
              ...(input["id"] === undefined ? {} : { id: input["id"] }),
              title: input["title"],
              ...(input["metadata"] === undefined ? {} : { metadata: input["metadata"] }),
              fields: input["fields"],
            },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      get: (input: FormGetInput, requestOptions?: RequestOptions) =>
        request<FormGetOutput>(
          {
            schemaKey: '["api.form","session.form.get"]',
            method: "GET",
            path: (params, wildcard) =>
              `/api/session/${encodeURIComponent(String(params["sessionID"]))}/form/${encodeURIComponent(String(params["formID"]))}`,
            params: { sessionID: input["sessionID"], formID: input["formID"] },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      state: (input: FormStateInput, requestOptions?: RequestOptions) =>
        request<FormStateOutput>(
          {
            schemaKey: '["api.form","session.form.state"]',
            method: "GET",
            path: (params, wildcard) =>
              `/api/session/${encodeURIComponent(String(params["sessionID"]))}/form/${encodeURIComponent(String(params["formID"]))}/state`,
            params: { sessionID: input["sessionID"], formID: input["formID"] },
            successStatus: 200,
            empty: false,
          },
          requestOptions,
        ),
      reply: (input: FormReplyInput, requestOptions?: RequestOptions) =>
        request<FormReplyOutput>(
          {
            schemaKey: '["api.form","session.form.reply"]',
            method: "POST",
            path: (params, wildcard) =>
              `/api/session/${encodeURIComponent(String(params["sessionID"]))}/form/${encodeURIComponent(String(params["formID"]))}/reply`,
            params: { sessionID: input["sessionID"], formID: input["formID"] },
            body: { answer: input["answer"] },
            successStatus: 204,
            empty: true,
          },
          requestOptions,
        ),
      cancel: (input: FormCancelInput, requestOptions?: RequestOptions) =>
        request<FormCancelOutput>(
          {
            schemaKey: '["api.form","session.form.cancel"]',
            method: "POST",
            path: (params, wildcard) =>
              `/api/session/${encodeURIComponent(String(params["sessionID"]))}/form/${encodeURIComponent(String(params["formID"]))}/cancel`,
            params: { sessionID: input["sessionID"], formID: input["formID"] },
            successStatus: 204,
            empty: true,
          },
          requestOptions,
        ),
    },
  }
}

function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/")
}

function appendQuery(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined) return
  if (value === null) {
    params.append(key, "null")
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) appendQuery(params, key, item)
    return
  }
  if (typeof value === "object") {
    for (const [child, item] of Object.entries(value)) appendQuery(params, `${key}[${child}]`, item)
    return
  }
  params.append(key, String(value))
}

async function json(response: Response): Promise<unknown> {
  if (!isContentType(response, "application/json") && !response.headers.get("content-type")?.includes("+json")) {
    try {
      await response.body?.cancel()
    } catch {}
    throw new ClientError("UnsupportedContentType")
  }
  let text: string
  try {
    text = await response.text()
  } catch (cause) {
    throw new ClientError("Transport", { cause })
  }
  if (text === "") throw new ClientError("MalformedResponse")
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new ClientError("MalformedResponse", { cause })
  }
}

function requireContentType(response: Response, expected: string): void {
  if (isContentType(response, expected)) return
  try {
    void response.body?.cancel()
  } catch {}
  throw new ClientError("UnsupportedContentType")
}

function isContentType(response: Response, expected: string) {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === expected
}
