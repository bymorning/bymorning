import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { Config } from "../src/config.js"

describe("Config MCP", () => {
  it("decodes remote Streamable HTTP servers and ignores removed tool selection data", () => {
    const config = Schema.decodeUnknownSync(Config.Info)({
      mcp: {
        activation: { context7: "disabled", future: "enabled" },
        tools: ["read"],
        servers: {
          context7: {
            type: "remote",
            url: "https://mcp.context7.com/mcp",
            headers: { authorization: "Bearer secret" },
            codemode: true,
            timeout: { startup: 500, catalog: 1_000, execution: 5_000 },
          },
        },
      },
    })

    expect(config.mcp).toMatchObject({
      activation: { context7: "disabled", future: "enabled" },
      servers: {
        context7: {
          type: "remote",
          url: "https://mcp.context7.com/mcp",
          timeout: { startup: 500, catalog: 1_000, execution: 5_000 },
        },
      },
    })
    expect(config.mcp).not.toHaveProperty("tools")
  })
})
