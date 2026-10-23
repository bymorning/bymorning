import { describe, expect, it } from "vitest"
import { ConfigMCP } from "../src/config/mcp.js"

describe("ConfigMCP header placeholders", () => {
  it("parses member values, ByMorning values, literal text, and escapes", () => {
    expect(ConfigMCP.parseHeader("Bearer ${TOKEN}")).toEqual({
      segments: [
        { type: "text", text: "Bearer " },
        { type: "member", name: "TOKEN" },
      ],
    })
    expect(ConfigMCP.parseHeader("${member.email}")).toEqual({ segments: [{ type: "builtin", name: "member.email" }] })
    expect(ConfigMCP.parseHeader("$${TOKEN} costs $5")).toEqual({ segments: [{ type: "text", text: "${TOKEN} costs $5" }] })
    expect(ConfigMCP.parseHeader("plain")).toEqual({ segments: [{ type: "text", text: "plain" }] })
  })

  it("reports malformed placeholders and unknown ByMorning values", () => {
    expect(ConfigMCP.parseHeader("${TOKEN")).toMatchObject({ error: expect.stringContaining("Unclosed") })
    expect(ConfigMCP.parseHeader("${bad name}")).toMatchObject({ error: expect.stringContaining("Invalid placeholder") })
    expect(ConfigMCP.parseHeader("${member.phone}")).toMatchObject({
      error: expect.stringContaining("Unknown ByMorning value"),
    })
  })

  it("collects each distinct name once across headers", () => {
    expect(
      ConfigMCP.placeholders({
        A: "${JIRA}",
        B: "Bearer ${JIRA}-${CONFLUENCE}",
        C: "${member.email}",
        D: "shared",
      }),
    ).toEqual({ member: ["JIRA", "CONFLUENCE"], builtin: ["member.email"] })
    expect(ConfigMCP.personal({ D: "shared", E: "$${escaped}" })).toBe(false)
    expect(ConfigMCP.personal({ A: "${X}" })).toBe(true)
    expect(ConfigMCP.placeholders(undefined)).toEqual({ member: [], builtin: [] })
  })
})

describe("ConfigMCP header redaction", () => {
  const config = {
    mcp: {
      servers: {
        river: {
          type: "remote" as const,
          url: "https://river.example/mcp",
          oauth: false as const,
          headers: {
            "X-Shared": "shared-secret",
            JiraToken: "${JIRA_TOKEN}",
            Authorization: "Bearer ${TOKEN}",
            UserEmail: "${member.email}",
            Literal: "$${notplaceholder}",
          },
        },
        plain: { type: "remote" as const, url: "https://plain.example/mcp" },
      },
    },
  }

  it("hides shared values and keeps templates that only name member values", () => {
    const redacted = ConfigMCP.redact(config)
    expect(redacted.mcp.servers.river.headers).toEqual({
      "X-Shared": ConfigMCP.redacted,
      JiraToken: "${JIRA_TOKEN}",
      Authorization: "Bearer ${TOKEN}",
      UserEmail: "${member.email}",
      Literal: ConfigMCP.redacted,
    })
    expect(redacted.mcp.servers.plain).toEqual(config.mcp.servers.plain)
    expect(JSON.stringify(redacted)).not.toContain("shared-secret")
    // The original document is never mutated.
    expect(config.mcp.servers.river.headers["X-Shared"]).toBe("shared-secret")
  })

  it("restores stored values for markers returned unchanged and leaves edits alone", () => {
    const returned = ConfigMCP.redact(config)
    expect(ConfigMCP.restore(returned, config)).toEqual(config)
    const edited = {
      mcp: { servers: { river: { ...returned.mcp.servers.river, headers: { "X-Shared": "new-value" } } } },
    }
    expect(ConfigMCP.restore(edited, config).mcp.servers.river.headers).toEqual({ "X-Shared": "new-value" })
  })

  it("returns configurations without headers untouched", () => {
    const bare = { mcp: { servers: { plain: config.mcp.servers.plain } } }
    expect(ConfigMCP.redact(bare)).toBe(bare)
    expect(ConfigMCP.redact({})).toEqual({})
  })
})
