import { Plugin, type PluginConfigurationFields } from "@bymorning/plugin"

export interface ServerSpec {
  readonly key: string
  readonly title: string
  readonly description: string
  readonly defaultURL: string
}

/** Official Google-hosted remote MCP endpoints (Developer Preview). */
export const servers: readonly ServerSpec[] = [
  {
    key: "gmail",
    title: "Gmail",
    description: "Profile access, drafting, searching, and message read/label capabilities.",
    defaultURL: "https://gmailmcp.googleapis.com/mcp/v1",
  },
  {
    key: "drive",
    title: "Drive",
    description: "File fetching, listing, uploading, and permissions management.",
    defaultURL: "https://drivemcp.googleapis.com/mcp/v1",
  },
  {
    key: "docs",
    title: "Docs",
    description: "Read and write Google Documents.",
    defaultURL: "https://docsmcp.googleapis.com/mcp/v1",
  },
  {
    key: "sheets",
    title: "Sheets",
    description: "Read and write spreadsheets, values, and formulas.",
    defaultURL: "https://sheetsmcp.googleapis.com/mcp/v1",
  },
  {
    key: "slides",
    title: "Slides",
    description: "Read and update presentations.",
    defaultURL: "https://slidesmcp.googleapis.com/mcp/v1",
  },
  {
    key: "calendar",
    title: "Calendar",
    description: "Find available times and manage events.",
    defaultURL: "https://calendarmcp.googleapis.com/mcp/v1",
  },
  {
    key: "chat",
    title: "Chat",
    description: "Find conversations, search messages, and read/send replies.",
    defaultURL: "https://chatmcp.googleapis.com/mcp/v1",
  },
  {
    key: "people",
    title: "People",
    description: "Manage user contacts and access profile information.",
    defaultURL: "https://people.googleapis.com/mcp/v1",
  },
  {
    key: "universal",
    title: "Universal Search",
    description: "Search across Gmail, Drive, Calendar, and Chat with one tool.",
    defaultURL: "https://workspacemcp.googleapis.com/mcp/v1",
  },
]

const errorMessage = "Invalid Google Workspace MCP configuration"

export function enableKey(key: string): string {
  return `enable-${key}`
}

export function urlKey(key: string): string {
  return `url-${key}`
}

/**
 * Resolve a non-secret MCP endpoint URL. Accepts HTTPS URLs without
 * credentials, query strings, or fragments. Never echoes the value.
 */
export function resolveURL(value: unknown, fallback: string): string {
  if (value === undefined) return fallback
  if (typeof value !== "string") throw new Error(errorMessage)
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "")
      throw new Error(errorMessage)
    return url.href
  } catch {
    throw new Error(errorMessage)
  }
}

function isEnabled(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== "boolean") throw new Error(errorMessage)
  return value
}

/** One enable flag plus one endpoint URL per server; nine servers keep it non-empty. */
function configurationFields(): PluginConfigurationFields {
  const fields = servers.flatMap((server) => [
    {
      key: enableKey(server.key),
      type: "boolean" as const,
      title: `Enable ${server.title}`,
      description: `${server.description} Enabled by default except Universal Search.`,
      default: defaultEnabled(server.key),
    },
    {
      key: urlKey(server.key),
      type: "string" as const,
      title: `${server.title} MCP URL`,
      description: `HTTPS endpoint for the ${server.title} MCP server.`,
      format: "uri" as const,
      default: server.defaultURL,
    },
  ])
  return fields as unknown as PluginConfigurationFields
}

/** Universal Search overlaps the product servers, so it stays off unless selected. */
function defaultEnabled(key: string): boolean {
  return key !== "universal"
}

/** Registers the selected official Google Workspace remote MCP servers. */
const plugin = Plugin.define({
  id: "google.workspace-mcp",
  configuration: {
    title: "Google Workspace MCP",
    description:
      "Connect the official Google-hosted remote MCP servers. Authentication stays in each member's own Connection; URLs are non-secret configuration.",
    fields: configurationFields(),
  },
  async setup(context) {
    const selected = servers
      .filter((server) => isEnabled(context.options[enableKey(server.key)], defaultEnabled(server.key)))
      .map((server) => ({
        name: `google.workspace-mcp.${server.key}`,
        url: resolveURL(context.options[urlKey(server.key)], server.defaultURL),
      }))
    await context.mcp.transform((editor) => {
      for (const server of selected) editor.set(server.name, { type: "remote", url: server.url })
    })
  },
})

export default plugin
