import { Plugin } from "@bymorning/plugin"

/** Atlassian remote MCP server plugin. */
export const plugin = Plugin.define({
  id: "atlassian",
  async setup(context) {
    await context.mcp.transform((editor) => {
      editor.set("atlassian", {
        type: "remote",
        url: "https://mcp.atlassian.com/v2/mcp",
      })
    })
  },
})

export default plugin
