import { describe, expect, it } from "vitest"
import { enableKey, resolveURL, servers, urlKey } from "../src/google-mcp.js"

describe("google workspace mcp options", () => {
  it("accepts the official HTTPS endpoints", () => {
    for (const server of servers) {
      expect(resolveURL(server.defaultURL, server.defaultURL)).toBe(server.defaultURL)
    }
  })

  it("falls back to the default when unset", () => {
    expect(resolveURL(undefined, servers[0]?.defaultURL ?? "")).toBe(servers[0]?.defaultURL)
  })

  it.each(["http://gmailmcp.googleapis.com/mcp/v1", "not-a-url", 42, true, null])(
    "rejects non-HTTPS or non-string endpoint %s",
    (value) => {
      expect(() => resolveURL(value, "https://gmailmcp.googleapis.com/mcp/v1")).toThrow(
        "Invalid Google Workspace MCP configuration",
      )
    },
  )

  it.each([
    "https://user@gmailmcp.googleapis.com/mcp/v1",
    "https://user:pass@gmailmcp.googleapis.com/mcp/v1",
    "https://gmailmcp.googleapis.com/mcp/v1?key=value",
    "https://gmailmcp.googleapis.com/mcp/v1#fragment",
  ])("rejects endpoint with credentials, query, or fragment %s", (value) => {
    expect(() => resolveURL(value, "https://gmailmcp.googleapis.com/mcp/v1")).toThrow(
      "Invalid Google Workspace MCP configuration",
    )
  })

  it("does not echo the rejected value", () => {
    const rejected = "https://user:secret@gmailmcp.googleapis.com/mcp/v1"
    try {
      resolveURL(rejected, "https://gmailmcp.googleapis.com/mcp/v1")
      expect.unreachable()
    } catch (error) {
      expect(String(error)).not.toContain("secret")
    }
  })

  it("derives distinct option keys per server", () => {
    const enableKeys = new Set(servers.map((server) => enableKey(server.key)))
    const urlKeys = new Set(servers.map((server) => urlKey(server.key)))
    expect(enableKeys.size).toBe(servers.length)
    expect(urlKeys.size).toBe(servers.length)
  })
})
