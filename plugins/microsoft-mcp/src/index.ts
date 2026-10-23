import { Plugin } from "@bymorning/plugin"

const gatewayBase = "https://agent365.svc.cloud.microsoft"
const enterpriseURL = "https://mcp.svc.cloud.microsoft/enterprise"
const tenantPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

interface ServerDefinition {
  readonly value: string
  readonly name: string
  readonly label: string
  readonly description: string
  readonly url: (tenantId: string) => string
}

const servers: readonly ServerDefinition[] = [
  {
    value: "mcp_SharePointRemoteServer",
    name: "microsoft.sharepoint",
    label: "SharePoint",
    description: "Sites, lists, document libraries, and files up to 5 MB.",
    url: (tenantId) => `${gatewayBase}/agents/tenants/${tenantId}/servers/mcp_SharePointRemoteServer`,
  },
  {
    value: "mcp_OneDriveRemoteServer",
    name: "microsoft.onedrive",
    label: "OneDrive",
    description: "Files and folders in the signed-in user's OneDrive, up to 5 MB.",
    url: (tenantId) => `${gatewayBase}/agents/tenants/${tenantId}/servers/mcp_OneDriveRemoteServer`,
  },
  {
    value: "mcp_MailTools",
    name: "microsoft.mail",
    label: "Mail",
    description: "Outlook mail: drafts, send, reply, search, and manage messages.",
    url: (tenantId) => `${gatewayBase}/agents/tenants/${tenantId}/servers/mcp_MailTools`,
  },
  {
    value: "mcp_CalendarTools",
    name: "microsoft.calendar",
    label: "Calendar",
    description: "Outlook calendar: events, invites, and availability.",
    url: (tenantId) => `${gatewayBase}/agents/tenants/${tenantId}/servers/mcp_CalendarTools`,
  },
  {
    value: "mcp_TeamsServer",
    name: "microsoft.teams",
    label: "Teams",
    description: "Teams chats, channels, messages, and membership.",
    url: (tenantId) => `${gatewayBase}/agents/tenants/${tenantId}/servers/mcp_TeamsServer`,
  },
  {
    value: "mcp_WordServer",
    name: "microsoft.word",
    label: "Word",
    description: "Create and read Word documents; add and reply to comments.",
    url: (tenantId) => `${gatewayBase}/agents/tenants/${tenantId}/servers/mcp_WordServer`,
  },
  {
    value: "mcp_M365Copilot",
    name: "microsoft.copilot",
    label: "Copilot",
    description: "Microsoft 365 Copilot search across organizational content.",
    url: (tenantId) => `${gatewayBase}/agents/tenants/${tenantId}/servers/mcp_M365Copilot`,
  },
  {
    value: "enterprise",
    name: "microsoft.enterprise",
    label: "Enterprise directory",
    description: "Read-only Microsoft Entra directory and reporting queries.",
    url: () => enterpriseURL,
  },
]

const byValue = new Map(servers.map((server) => [server.value, server]))
const defaultServers = servers.filter((server) => server.value !== "enterprise").map((server) => server.value)

/** Resolve validated, non-secret plugin options into tenant-scoped MCP server URLs. */
export function resolveServers(
  options: Readonly<Record<string, unknown>>,
): { name: string; url: string }[] {
  const tenantId = options["tenantId"]
  if (typeof tenantId !== "string" || !tenantPattern.test(tenantId))
    throw new Error("Invalid Microsoft MCP configuration")
  const selected = options["servers"] === undefined ? defaultServers : options["servers"]
  if (!Array.isArray(selected) || selected.length === 0 || !selected.every((value) => typeof value === "string"))
    throw new Error("Invalid Microsoft MCP configuration")
  return selected.map((value) => {
    const server = byValue.get(value)
    if (server === undefined) throw new Error("Invalid Microsoft MCP configuration")
    const url = new URL(server.url(tenantId))
    if (url.protocol !== "https:") throw new Error("Invalid Microsoft MCP configuration")
    return { name: server.name, url: url.href }
  })
}

/** Microsoft 365 remote MCP servers (Agent 365 / Work IQ) behind Entra authentication. */
export const plugin = Plugin.define({
  id: "microsoft.mcp",
  configuration: {
    title: "Microsoft 365 MCP",
    description:
      "Connect official Microsoft Agent 365 remote MCP servers for SharePoint, OneDrive, Mail, Calendar, Teams, Word, Copilot, and the read-only Enterprise directory.",
    fields: [
      {
        key: "tenantId",
        type: "string",
        title: "Entra tenant ID",
        description: "Microsoft Entra directory (tenant) ID scoping the Agent 365 gateway URLs.",
        required: true,
        minLength: 36,
        maxLength: 36,
        pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
      },
      {
        key: "servers",
        type: "multiselect",
        title: "MCP servers",
        description: "Microsoft MCP servers to register. Authentication stays in the host Connection flow.",
        options: servers.map(({ value, label, description }) => ({ value, label, description })),
        default: defaultServers,
      },
    ],
  },
  async setup(context) {
    const resolved = resolveServers(context.options)
    await context.mcp.transform((editor) => {
      for (const server of resolved) editor.set(server.name, { type: "remote", url: server.url })
    })
  },
})

export default plugin
