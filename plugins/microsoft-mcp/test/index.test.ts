import { describe, expect, test } from "vitest"
import { resolveServers } from "../src/index.js"

const tenantId = "12345678-1234-1234-1234-1234567890ab"

describe("resolveServers", () => {
  test("builds tenant-scoped HTTPS URLs for the default selection", () => {
    const resolved = resolveServers({ tenantId })
    expect(resolved.map((server) => server.name)).toEqual([
      "microsoft.sharepoint",
      "microsoft.onedrive",
      "microsoft.mail",
      "microsoft.calendar",
      "microsoft.teams",
      "microsoft.word",
      "microsoft.copilot",
    ])
    for (const server of resolved) {
      expect(server.url.startsWith(`https://agent365.svc.cloud.microsoft/agents/tenants/${tenantId}/servers/`)).toBe(
        true,
      )
    }
  })

  test("registers the fixed Enterprise directory URL without tenant scoping", () => {
    expect(resolveServers({ tenantId, servers: ["enterprise"] })).toEqual([
      { name: "microsoft.enterprise", url: "https://mcp.svc.cloud.microsoft/enterprise" },
    ])
  })

  test("rejects missing, malformed, and unknown values", () => {
    expect(() => resolveServers({})).toThrow("Invalid Microsoft MCP configuration")
    expect(() => resolveServers({ tenantId: "not-a-guid" })).toThrow("Invalid Microsoft MCP configuration")
    expect(() => resolveServers({ tenantId, servers: [] })).toThrow("Invalid Microsoft MCP configuration")
    expect(() => resolveServers({ tenantId, servers: ["mcp_Unknown"] })).toThrow(
      "Invalid Microsoft MCP configuration",
    )
  })
})
