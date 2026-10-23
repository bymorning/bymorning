import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { EmptyPayload, ForbiddenError, InputError, InternalError, McpServerNotFoundError } from "../errors.js"
import { WorkspaceQuery } from "../middleware/workspace-middleware.js"

const Named = {
  name: Schema.String,
  url: Schema.optionalKey(Schema.String),
  enabled: Schema.Boolean,
  /** How members authenticate: the server's own OAuth, or values each member supplies. */
  auth: Schema.optionalKey(Schema.Literals(["oauth", "values"])),
}
const Integration = { integrationID: Schema.optionalKey(Schema.String) }
export const McpServer = Schema.Union([
  Schema.Struct({ ...Named, status: Schema.Literal("connected"), ...Integration }),
  Schema.Struct({ ...Named, status: Schema.Literal("pending"), ...Integration }),
  Schema.Struct({ ...Named, status: Schema.Literal("disabled"), ...Integration }),
  Schema.Struct({ ...Named, status: Schema.Literal("failed"), error: Schema.String, ...Integration }),
  Schema.Struct({ ...Named, status: Schema.Literal("needs_auth"), integrationID: Schema.String }),
]).pipe(Schema.toTaggedUnion("status"))

/** One Tool discovered from a configured outbound MCP server. */
export const McpTool = Schema.Struct({
  server: Schema.String,
  name: Schema.String,
  action: Schema.String,
  description: Schema.optionalKey(Schema.String),
})

const OAuth = Schema.Union([
  Schema.Literal(false),
  Schema.Struct({
    client_id: Schema.optionalKey(Schema.String),
    scope: Schema.optionalKey(Schema.String),
  }),
])
const ServerInput = Schema.Struct({
  url: Schema.String,
  oauth: Schema.optionalKey(OAuth),
  codemode: Schema.optionalKey(Schema.Boolean),
  disabled: Schema.optionalKey(Schema.Boolean),
  /**
   * Request headers. A value may refer to a Member Value as `${NAME}`, which each
   * member supplies for themselves, or to `${member.email}`; `$${` is a literal
   * `${`. Member values require `oauth: false`.
   */
  headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
})
const ServerParams = { server: Schema.String }
const ActivationInput = Schema.Struct({ enabled: Schema.Boolean })

/** Whether one Workspace member has saved their own values for a server. Never the values. */
export const McpServerMember = Schema.Struct({
  userID: Schema.String,
  email: Schema.String,
  connected: Schema.Boolean,
  /** When the member's values last changed, as an ISO-8601 instant. */
  updated: Schema.optionalKey(Schema.String),
})
export interface McpServerMember extends Schema.Schema.Type<typeof McpServerMember> {}

/** Outcome of a one-shot outbound MCP connection test. */
export const McpServerTest = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optionalKey(Schema.String),
})
export interface McpServerTest extends Schema.Schema.Type<typeof McpServerTest> {}

export const McpSettingsGroup = HttpApiGroup.make("api.mcp")
  .add(
    HttpApiEndpoint.put("mcp.servers.update", "/mcp/server/:server/activation", {
      params: ServerParams,
      query: WorkspaceQuery,
      payload: ActivationInput,
      success: McpServer,
      error: [InputError, ForbiddenError, McpServerNotFoundError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.get("mcp.tools.list", "/mcp/tool", {
      query: WorkspaceQuery,
      success: Schema.Array(McpTool),
    }),
  )
  .add(
    HttpApiEndpoint.get("mcp.servers.list", "/mcp/server", {
      query: WorkspaceQuery,
      success: Schema.Array(McpServer),
    }),
  )
  .add(
    HttpApiEndpoint.put("mcp.servers.put", "/mcp/server/:server", {
      params: ServerParams,
      query: WorkspaceQuery,
      payload: ServerInput,
      success: Schema.Void,
      error: [InputError, ForbiddenError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.delete("mcp.servers.remove", "/mcp/server/:server", {
      params: ServerParams,
      query: WorkspaceQuery,
      success: Schema.Void,
      error: [InputError, ForbiddenError, McpServerNotFoundError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.get("mcp.servers.members", "/mcp/server/:server/member", {
      params: ServerParams,
      query: WorkspaceQuery,
      success: Schema.Array(McpServerMember),
      error: [InputError, ForbiddenError, McpServerNotFoundError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.post("mcp.servers.connect", "/mcp/server/:server/connect", {
      params: ServerParams,
      query: WorkspaceQuery,
      payload: EmptyPayload,
      success: Schema.Void,
      error: [InputError, McpServerNotFoundError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.post("mcp.servers.disconnect", "/mcp/server/:server/disconnect", {
      params: ServerParams,
      query: WorkspaceQuery,
      payload: EmptyPayload,
      success: Schema.Void,
      error: [InputError, McpServerNotFoundError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.post("mcp.servers.test", "/mcp/server/:server/test", {
      params: ServerParams,
      query: WorkspaceQuery,
      payload: EmptyPayload,
      success: McpServerTest,
      error: [InputError, McpServerNotFoundError, InternalError],
    }),
  )
  .prefix("/api")
