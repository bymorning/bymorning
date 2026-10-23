import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { describe, expect, test } from "vitest"
import { McpSettingsGroup } from "../../src/groups/mcp.js"

const api = HttpApi.make("test").add(McpSettingsGroup)

describe("MCP settings protocol", () => {
  test("publishes server and discovered Tool settings without restoring the removed diagnostics catalog", () => {
    const paths = OpenApi.fromApi(api).paths
    expect(paths["/api/mcp/catalog"]).toBeUndefined()
    expect(paths["/api/mcp/server"]).toBeDefined()
    expect(paths["/api/mcp/tool"]).toBeDefined()
    expect(paths["/api/mcp/server/{server}/activation"]?.put?.operationId).toBe("api.mcp.mcp.servers.update")
  })
})
