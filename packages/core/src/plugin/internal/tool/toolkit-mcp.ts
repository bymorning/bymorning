/** Toolkit MCP runtime and configuration Tools. */
import { Effect, Schema } from "effect"
import type { Interface as ConfigInterface } from "../../../config.js"
import { Mcp } from "../../../mcp.js"
import { Tool } from "../../../tool.js"
import { McpTool } from "../../../tool/mcp.js"
import type { ToolEditor } from "@bymorning/plugin/effect/tool"
import { McpNamespace, operational } from "./toolkit-shared.js"

const ServerInput = Schema.Struct({ server: Schema.String })

const MCPServer = Schema.Union([
  Schema.Struct({
    name: Schema.String,
    enabled: Schema.Boolean,
    status: Schema.Literal("connected"),
    integrationID: Schema.optionalKey(Schema.String),
    url: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    name: Schema.String,
    enabled: Schema.Boolean,
    status: Schema.Literal("pending"),
    integrationID: Schema.optionalKey(Schema.String),
    url: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    name: Schema.String,
    enabled: Schema.Boolean,
    status: Schema.Literal("disabled"),
    integrationID: Schema.optionalKey(Schema.String),
    url: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    name: Schema.String,
    enabled: Schema.Boolean,
    status: Schema.Literal("needs_auth"),
    integrationID: Schema.String,
    url: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    name: Schema.String,
    enabled: Schema.Boolean,
    status: Schema.Literal("failed"),
    error: Schema.String,
    integrationID: Schema.optionalKey(Schema.String),
    url: Schema.optionalKey(Schema.String),
  }),
]).pipe(Schema.toTaggedUnion("status"))
const MCPConnection = Schema.Struct({ status: Schema.Literal("connected"), server: Schema.String })
const MCPDisconnection = Schema.Struct({ status: Schema.Literal("disconnected"), server: Schema.String })
const MCPConfigured = Schema.Struct({
  name: Schema.String,
  url: Schema.String,
  codemode: Schema.optionalKey(Schema.Boolean),
})
const MCPInventory = Schema.Struct({ servers: Schema.Array(MCPConfigured) })

const mcpError = (error: unknown) =>
  new Tool.Error({
    message:
      error instanceof Mcp.NotFoundError
        ? `MCP server ${JSON.stringify(error.server)} is not configured`
        : error instanceof Mcp.AuthorizationError
          ? error.message
          : "MCP operation could not be completed",
  })

const missingServer = () => new Tool.Error({ message: "A configured MCP server is required" })
const unknownServer = (server: string) =>
  new Tool.Error({ message: `MCP server ${JSON.stringify(server)} is not configured` })

export const registerMcpTools = (
  editor: ToolEditor,
  deps: {
    readonly mcp: Mcp.Interface
    readonly mcpTool: McpTool.Interface
    readonly config: ConfigInterface
  },
) => {
  const { mcp, mcpTool, config } = deps

  const connectMcp = (input: typeof ServerInput.Type, toolContext: Tool.Context) =>
    Effect.gen(function* () {
      const server = input.server
      if (server === "") return yield* missingServer()
      yield* toolContext.permission({ action: "mcp_connect", resources: [server] })
      const find = (name: string) => Effect.map(mcp.servers(), (servers) => servers.find((item) => item.name === name))
      let status = yield* find(server)
      if (!status) return yield* unknownServer(server)
      if (status.status === "disabled") yield* mcp.connect(server).pipe(Effect.mapError(mcpError))
      status = yield* find(server)
      if (!status) return yield* unknownServer(server)
      if (status.status === "needs_auth")
        yield* mcp.authorize({ server, elicit: toolContext.elicit }).pipe(Effect.mapError(mcpError))
      else if (status.status !== "connected")
        return yield* new Tool.Error({
          message:
            status.status === "failed"
              ? `MCP server ${JSON.stringify(server)} failed to connect`
              : "MCP server is not ready to connect",
        })
      yield* mcpTool.refresh
      return {
        output: { status: "connected" as const, server },
        content: [{ type: "text" as const, text: `Connected MCP server: ${server}` }],
      }
    })

  editor.namespace({
    name: McpNamespace,
    description:
      "Use when the user wants to inspect outbound MCP servers or manage their live connections.",
  })
  editor.add({
    name: "connect",
    description:
      "Use when the user wants to connect a configured MCP server, requesting OAuth authorization when needed.",
    input: ServerInput,
    output: MCPConnection,
    options: { ...operational("mcp_connect", McpNamespace) },
    execute: connectMcp,
  })
  editor.add({
    name: "mcp_connect",
    description: "Deprecated alias for toolkit.mcp.connect.",
    input: ServerInput,
    output: MCPConnection,
    options: { permission: "mcp_connect", gateway: true, pinned: true },
    execute: connectMcp,
  })
  editor.add({
    name: "disconnect",
    description:
      "Use when the user wants to disconnect an MCP server runtime without deleting its configuration or credentials.",
    input: ServerInput,
    output: MCPDisconnection,
    options: { ...operational("mcp_disconnect", McpNamespace) },
    execute: (input, toolContext) =>
      Effect.gen(function* () {
        if (input.server === "") return yield* missingServer()
        yield* toolContext.permission({ action: "mcp_disconnect", resources: [input.server] })
        yield* mcp.disconnect(input.server).pipe(Effect.mapError(mcpError))
        return { output: { status: "disconnected", server: input.server } }
      }),
  })
  editor.add({
    name: "status",
    description: "Use when the user wants the current secret-free MCP server status.",
    input: ServerInput,
    output: MCPServer,
    options: { ...operational("mcp_status", McpNamespace) },
    execute: (input, toolContext) =>
      Effect.gen(function* () {
        if (input.server === "") return yield* missingServer()
        yield* toolContext.permission({ action: "mcp_status", resources: [input.server] })
        const status = (yield* mcp.servers()).find((item) => item.name === input.server)
        if (!status) return yield* unknownServer(input.server)
        return { output: status }
      }),
  })
  editor.add({
    name: "list",
    description: "Use when the user wants to list configured outbound MCP servers without header values.",
    input: Schema.Struct({}),
    output: MCPInventory,
    options: { ...operational("mcp_list", McpNamespace) },
    execute: (_input, toolContext) =>
      Effect.gen(function* () {
        yield* toolContext.permission({ action: "mcp_list", resources: ["mcp"] })
        const servers = (yield* config.get).mcp?.servers ?? {}
        return {
          output: {
            servers: Object.entries(servers).map(([name, server]) => ({
              name,
              url: server.url,
              ...(server.codemode === undefined ? {} : { codemode: server.codemode }),
            })),
          },
        }
      }),
  })
}
