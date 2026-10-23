import { describe, expect, it } from "vitest"
import type { Context } from "@bymorning/plugin/promise/plugin"
import plugin from "../src/index.js"

describe("Atlassian plugin", () => {
  it("contributes the remote MCP server", async () => {
    const servers = new Map<string, unknown>()
    await plugin.setup({
      mcp: {
        transform: async (callback: (editor: { set(name: string, server: unknown): void }) => void) => {
          callback({ set: (name, server) => servers.set(name, server) })
          return { dispose: async () => undefined }
        },
      },
    } as unknown as Context)

    expect(servers).toEqual(new Map([["atlassian", { type: "remote", url: "https://mcp.atlassian.com/v2/mcp" }]]))
  })
})
