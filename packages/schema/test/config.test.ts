import * as Config from "@bymorning/schema/config"
import * as SessionConfig from "@bymorning/schema/session/config"
import * as ConfigToolOutput from "@bymorning/schema/config/tool-output"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"

describe("Config.Info", () => {
  const modelPolicy = { model_policy: { disabled: [], seen: [], initialized: [] } }
  const permissions = { permissions: [] }

  test("composes the Session-owned Config fields", () => {
    expect(Config.Info.fields.default_agent).toBe(SessionConfig.Info.fields.default_agent)
    expect(Config.Info.fields.default_model).toBe(SessionConfig.Info.fields.default_model)
    expect(Config.Info.fields.compaction).toBe(SessionConfig.Info.fields.compaction)
  })

  test("decodes absent fields to Session defaults", () => {
    expect(Schema.decodeUnknownSync(Config.Stored)({})).toEqual({})
    expect(Schema.decodeUnknownSync(Config.Info)({})).toEqual({
      ...SessionConfig.defaults,
      ...permissions,
      ...modelPolicy,
    })
    expect(
      Schema.decodeUnknownSync(Config.Info)({
        default_agent: "build",
        default_model: { provider: "bymorning", id: "fast" },
      }),
    ).toEqual({
      default_agent: "build",
      default_model: { provider: "bymorning", id: "fast" },
      ...SessionConfig.defaults,
      ...permissions,
      ...modelPolicy,
    })
    expect(() => Schema.decodeUnknownSync(Config.Info)({ default_agent: 1 })).toThrow()
    expect(() => Schema.decodeUnknownSync(Config.Info)({ default_model: "fast" })).toThrow()
  })

  test("decodes legacy Model policy without seen identities", () => {
    expect(
      Schema.decodeUnknownSync(Config.Info)({
        model_policy: { disabled: [{ provider: "openai", id: "old" }], initialized: ["openai"] },
      }).model_policy,
    ).toEqual({
      disabled: [{ provider: "openai", id: "old" }],
      seen: [],
      initialized: ["openai"],
    })
  })

  test("decodes sparse Tool output limits with their defaults", () => {
    expect(Schema.decodeUnknownSync(Config.Info)({ tool_output: {} })).toEqual({
      ...SessionConfig.defaults,
      ...permissions,
      ...modelPolicy,
      tool_output: ConfigToolOutput.defaults,
    })
    expect(Schema.decodeUnknownSync(Config.Info)({ tool_output: { max_lines: 12 } }).tool_output).toEqual({
      max_lines: 12,
      max_bytes: 50 * 1_024,
    })
    expect(() => Schema.decodeUnknownSync(Config.Info)({ tool_output: { max_lines: 0 } })).toThrow()
    expect(() => Schema.decodeUnknownSync(Config.Info)({ tool_output: { max_lines: 1 } })).toThrow()
    expect(() => Schema.decodeUnknownSync(Config.Info)({ tool_output: { max_bytes: 1.5 } })).toThrow()
    expect(() => Schema.decodeUnknownSync(Config.Info)({ tool_output: { max_bytes: 3 } })).toThrow()
  })

  test("decodes ordered plugin source declarations without changing existing defaults", () => {
    expect(
      Schema.decodeUnknownSync(Config.Info)({
        plugins: ["core.*", "-core.tool.read", { package: "@example/plugin", options: { mode: "fast" } }],
      }),
    ).toEqual({
      plugins: ["core.*", "-core.tool.read", { package: "@example/plugin", options: { mode: "fast" } }],
      ...SessionConfig.defaults,
      ...permissions,
      ...modelPolicy,
    })
    expect(Schema.decodeUnknownSync(Config.Stored)({ plugins: ["./plugin.ts"] })).toEqual({
      plugins: ["./plugin.ts"],
    })
  })

  test("decodes optional Gateway hard caps without adding defaults", () => {
    expect(Schema.decodeUnknownSync(Config.Stored)({})).toEqual({})
    expect(
      Schema.decodeUnknownSync(Config.Info)({
        gateway: {
          limits: { rpm: 0, tpm: 500_000 },
          models: [],
        },
      }).gateway,
    ).toEqual({ limits: { rpm: 0, tpm: 500_000 }, models: [] })
    expect(
      Schema.decodeUnknownSync(Config.Info)({
        gateway: { models: ["bymorning/gpt-5.6-luna", "kimi-k2p6"] },
      }).gateway?.models,
    ).toEqual(["bymorning/gpt-5.6-luna", "kimi-k2p6"])
  })

  test.each([
    { gateway: null },
    { gateway: { limits: { rpm: -1 } } },
    { gateway: { limits: { rpm: 1.5 } } },
    { gateway: { limits: { tpm: -1 } } },
    { gateway: { limits: { tpm: 1.5 } } },
    { gateway: { limits: null } },
    { gateway: { models: null } },
  ])("rejects malformed Gateway caps: %j", (input) => {
    expect(() => Schema.decodeUnknownSync(Config.Info)(input)).toThrow()
  })

  test("decodes omitted providers and routing without adding defaults", () => {
    expect(Schema.decodeUnknownSync(Config.Stored)({})).toEqual({})
    expect(Schema.decodeUnknownSync(Config.Info)({ providers: {} }).providers).toEqual({})
    expect(Schema.decodeUnknownSync(Config.Info)({ providers: { allow: [] } }).providers).toEqual({ allow: [] })
    expect(Schema.decodeUnknownSync(Config.Info)({ routing: [] }).routing).toEqual([])
    expect(Schema.decodeUnknownSync(Config.Stored)({ routing: [] })).toEqual({ routing: [] })
    expect(
      Schema.decodeUnknownSync(Config.Info)({
        providers: { allow: ["openai"] },
      }),
    ).toEqual({
      providers: { allow: ["openai"] },
      ...SessionConfig.defaults,
      ...permissions,
      ...modelPolicy,
    })
  })

  test("decodes legacy routing remaps into Match rules and writes the current shape", () => {
    const from = { provider: "openai", id: "gpt" }
    const legacy = [
      { to: { provider: "anthropic", id: "opus" }, from },
      { to: { provider: "openai", id: "o3" }, when: { tool: "bash" } },
      { to: { provider: "anthropic", id: "sonnet", variant: "thinking" }, from, when: { tool: "edit" } },
    ]
    const current = [
      { match: { model: from }, to: { provider: "anthropic", id: "opus" } },
      { match: { tool: "bash" }, to: { provider: "openai", id: "o3" } },
      { match: { model: from, tool: "edit" }, to: { provider: "anthropic", id: "sonnet", variant: "thinking" } },
    ]
    const decoded = Schema.decodeUnknownSync(Config.Info)({ routing: legacy })
    expect(decoded.routing).toEqual(current)
    expect(Schema.encodeSync(Config.Info)(decoded).routing).toEqual(current)
  })

  test("round-trips providers allow and Tier routing", () => {
    const input = {
      providers: { allow: ["openai", "anthropic"] },
      routing: [
        { match: { model: { provider: "openai", id: "gpt" } }, to: { provider: "anthropic", id: "opus" } },
        {
          match: { model: { provider: "auto", id: "general" }, purpose: ["assistant"] },
          to: {
            tiers: [
              { name: "fast", model: { provider: "anthropic", id: "haiku" }, description: "Short factual questions" },
              { name: "deep", model: { provider: "anthropic", id: "opus" }, description: "Multi-step engineering" },
            ],
            default: "fast",
            judge: { model: { provider: "anthropic", id: "haiku" }, timeout: 2_000 },
          },
        },
        { match: { text: { pattern: "urgent", flags: "i" }, context: { min: 1_000 }, images: true }, to: { provider: "openai", id: "o3" } },
      ],
    }
    const decoded = Schema.decodeUnknownSync(Config.Info)(input)
    expect(decoded.providers).toEqual(input.providers)
    expect(decoded.routing).toEqual(input.routing)
    expect(Schema.encodeSync(Config.Info)(decoded).routing).toEqual(input.routing)
    expect(Schema.decodeUnknownSync(Config.Stored)(input)).toEqual(input)
  })

  test.each([
    { routing: [{ to: { provider: "openai", id: "gpt" } }] },
    { providers: { allow: ["prv_openai"] } },
    { providers: { allow: [""] } },
    { providers: { allow: [1] } },
    { providers: { allow: "openai" } },
    { routing: { to: { provider: "openai", id: "gpt" }, from: { provider: "anthropic", id: "opus" } } },
    { routing: [{ to: { provider: "openai", id: "gpt" }, when: {} }] },
    { routing: [{ to: { provider: "openai", id: "gpt" }, when: { tool: 1 } }] },
    { routing: [{ match: { tool: "bash" }, to: { tiers: [], default: "a", judge: { model: { provider: "o", id: "m" } } } }] },
    { routing: [{ match: { text: { pattern: "x", flags: "g" } }, to: { provider: "openai", id: "gpt" } }] },
    { routing: [{ match: { purpose: ["route"] }, to: { provider: "openai", id: "gpt" } }] },
  ])("rejects malformed providers or routing: %j", (input) => {
    expect(() => Schema.decodeUnknownSync(Config.Info)(input)).toThrow()
  })

  test.each([
    { plugins: "@example/plugin" },
    { plugins: [1] },
    { plugins: [{}] },
    { plugins: [{ package: 1 }] },
    { plugins: [{ package: "@example/plugin", options: [] }] },
  ])("rejects malformed plugin declarations: %j", (input) => {
    expect(() => Schema.decodeUnknownSync(Config.Info)(input)).toThrow()
  })

  test("accepts compaction settings with non-negative integer thresholds", () => {
    expect(
      Schema.decodeUnknownSync(SessionConfig.Info)({
        compaction: { auto: false, keep: { tokens: 4_000 }, buffer: 1_000 },
      }),
    ).toEqual({ compaction: { auto: false, keep: { tokens: 4_000 }, buffer: 1_000 } })
    expect(Schema.decodeUnknownSync(Config.Info)({ compaction: { auto: false } })).toEqual({
      compaction: { auto: false, keep: { tokens: 15_000 }, buffer: 20_000 },
      ...permissions,
      ...modelPolicy,
    })
    expect(() => Schema.decodeUnknownSync(Config.Info)({ compaction: { keep: { tokens: -1 } } })).toThrow()
    expect(() => Schema.decodeUnknownSync(Config.Info)({ compaction: { buffer: 1.5 } })).toThrow()
  })

  test("encodes resolved defaults", () => {
    const resolved = Schema.decodeUnknownSync(Config.Info)({ compaction: { auto: false } })
    expect(Schema.encodeSync(Config.Info)(resolved)).toEqual({
      compaction: { auto: false, keep: { tokens: 15_000 }, buffer: 20_000 },
      permissions: [],
      model_policy: { disabled: [], seen: [], initialized: [] },
    })
  })

  test("round-trips ordered permission rules", () => {
    const rules = [
      { action: "read", resource: "*", effect: "allow" as const },
      { action: "read", resource: "*.env", effect: "deny" as const },
      { action: "context7_*", resource: "*", effect: "ask" as const },
    ]

    const decoded = Schema.decodeUnknownSync(Config.Info)({ permissions: rules })
    expect(decoded.permissions).toEqual(rules)
    expect(Schema.encodeSync(Config.Info)(decoded).permissions).toEqual(rules)
    expect(Schema.decodeUnknownSync(Config.Stored)({ permissions: rules })).toEqual({ permissions: rules })
  })

  test.each([
    { permissions: [{ action: "read", resource: "*", effect: "sometimes" }] },
    { permissions: [{ action: "read", effect: "allow" }] },
    { permissions: [{ action: 1, resource: "*", effect: "allow" }] },
  ])("rejects malformed permission rules: %j", (input) => {
    expect(() => Schema.decodeUnknownSync(Config.Info)(input)).toThrow()
  })
})
