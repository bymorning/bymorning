import { Config } from "../src/config.js"
import { OutboundMCPSettings } from "../src/outbound-mcp-settings.js"
import { SystemActor } from "@bymorning/schema/actor"
import { Workspace } from "@bymorning/schema/workspace"
import { Effect, Stream } from "effect"
import { describe, expect, it } from "vitest"

const system = new SystemActor({ type: "system", properties: { workspaceID: Workspace.ID.make("wrk_outbound_mcp_test") } })

describe("OutboundMCPSettings", () => {
  it("normalizes and delegates one canonical remote server", async () => {
    const writes: Array<readonly [string, unknown]> = []
    const config: Config.Interface = {
      provider: { update: () => Effect.die("unused") },
      model: { put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
      get: Effect.die("unused"), update: () => Effect.die("unused"), refresh: Effect.die("unused"),
      modelPolicy: { reconcile: () => Effect.die("unused"), toggle: () => Effect.die("unused"), setDefault: () => Effect.die("unused") },
      mcp: { update: () => Effect.die("unused"), put: (name, server) => Effect.sync(() => { writes.push([name, server]); return {} as never }), remove: () => Effect.die("unused") },
      plugin: Config.pluginUnavailable, entries: () => Effect.die("unused"), changes: () => Stream.never,
    }
    const result = await Effect.runPromise(OutboundMCPSettings.put(config, { name: " server ", url: "https://example.com" }, system))
    expect(result).toEqual({ name: "server", server: { type: "remote", url: "https://example.com/" } })
    expect(writes).toEqual([["server", result.server]])
  })

  it("rejects invalid names and protocols before persistence", async () => {
    const config = { mcp: { update: () => Effect.die("unused"), put: () => Effect.die("must not run") } } as unknown as Config.Interface
    expect(await Effect.runPromiseExit(OutboundMCPSettings.put(config, { name: "bad name", url: "https://example.com" }, system))).toMatchObject({ _tag: "Failure" })
    expect(await Effect.runPromiseExit(OutboundMCPSettings.put(config, { name: "ok", url: "file:///tmp/x" }, system))).toMatchObject({ _tag: "Failure" })
  })

  it("saves headers with member values only when OAuth is off", async () => {
    const writes: Array<readonly [string, unknown]> = []
    const config = {
      mcp: { update: () => Effect.die("unused"), put: (name: string, server: unknown) => Effect.sync(() => { writes.push([name, server]); return {} as never }) },
    } as unknown as Config.Interface
    const headers = { JiraToken: "${JIRA_TOKEN}", UserEmail: "${member.email}", "X-Team": "shared" }
    const result = await Effect.runPromise(
      OutboundMCPSettings.put(config, { name: "river", url: "https://river.example/mcp", oauth: false, headers }, system),
    )
    expect(result.server).toEqual({ type: "remote", url: "https://river.example/mcp", oauth: false, headers })
    expect(writes).toHaveLength(1)
  })

  it("refuses headers that combine OAuth with member values, are malformed, or could inject a header", async () => {
    const config = { mcp: { update: () => Effect.die("unused"), put: () => Effect.die("must not run") } } as unknown as Config.Interface
    const refused = async (input: Partial<OutboundMCPSettings.PutInput>) => {
      const exit = await Effect.runPromiseExit(
        OutboundMCPSettings.put(config, { name: "river", url: "https://river.example/mcp", ...input }, system),
      )
      expect(exit._tag).toBe("Failure")
      return exit._tag === "Failure" ? JSON.stringify(exit.cause) : ""
    }
    expect(await refused({ headers: { JiraToken: "${JIRA_TOKEN}" } })).toContain("cannot combine OAuth")
    expect(await refused({ oauth: {}, headers: { UserEmail: "${member.email}" } })).toContain("cannot combine OAuth")
    expect(await refused({ oauth: false, headers: { X: "${member.phone}" } })).toContain("Unknown ByMorning value")
    expect(await refused({ oauth: false, headers: { X: "${not valid}" } })).toContain("Invalid placeholder")
    expect(await refused({ oauth: false, headers: { X: "${OPEN" } })).toContain("Unclosed placeholder")
    expect(await refused({ headers: { "Bad Name": "x" } })).toContain("Invalid header name")
    expect(await refused({ headers: { X: "a\r\nInjected: 1" } })).toContain("line break")
  })
})
