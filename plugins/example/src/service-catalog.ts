import { Plugin } from "@bymorning/plugin"

const defaultURL = "https://services.example.com/mcp"

/** Adds a remote MCP service catalog; the endpoint is non-secret workspace configuration. */
const plugin = Plugin.define({
  id: "example.service-catalog",
  configuration: {
    title: "Service catalog MCP",
    description: "Connect a remote MCP server that exposes the organization's service catalog.",
    fields: [
      {
        key: "url",
        type: "string",
        title: "MCP URL",
        description: "HTTPS URL for the service catalog MCP endpoint.",
        format: "uri",
        required: true,
        default: defaultURL,
      },
    ],
  },
  async setup(context) {
    const url = configuredURL(context.options.url)
    await context.mcp.transform((editor) => {
      editor.set("example.service-catalog", { type: "remote", url })
    })
  },
})

function configuredURL(value: unknown) {
  if (value === undefined) return defaultURL
  if (typeof value !== "string") throw new Error("Invalid Service catalog MCP configuration")
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "")
      throw new Error("Invalid URL")
    return url.href
  } catch {
    throw new Error("Invalid Service catalog MCP configuration")
  }
}

export default plugin
