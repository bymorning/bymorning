import { Option, Schema } from "effect"
import { describe, expect, it } from "vitest"
import * as Policy from "../src/policy.js"

const decode = Schema.decodeUnknownSync(Policy.Policies, { errors: "all", onExcessProperty: "error" })
const decodeRule = Schema.decodeUnknownOption(Policy.Rule)

describe("Policy", () => {
  it("rejects empty required strings, unsupported actions, and unknown rules", () => {
    expect(() => decode([{ id: "", name: "x", enabled: true, rules: [] }])).toThrow()
    expect(() => Schema.decodeUnknownSync(Policy.Rule)({ type: "script", action: "x", resource: "*" })).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(Policy.RouteRule)({ type: "route", action: "tool.execute", resource: "*", target: "x" }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(Policy.Rule)({ type: "guardrail", action: "tool.execute", resource: "*", effect: "ask" }),
    ).toThrow()
  })

  it("strictly rejects excess policy and variant properties", () => {
    expect(() => decode([{ id: "x", name: "x", enabled: true, rules: [], extra: true }])).toThrow()
    expect(() =>
      decode([
        {
          id: "x",
          name: "x",
          enabled: true,
          rules: [{ type: "guardrail", action: "*", resource: "*", effect: "allow", message: "not allowed" }],
        },
      ]),
    ).toThrow()
    expect(() =>
      decode([
        {
          id: "x",
          name: "x",
          enabled: true,
          rules: [{ type: "route", action: "model.request", resource: "*", target: "x", message: "not allowed" }],
        },
      ]),
    ).toThrow()
  })

  it("rejects duplicate policy IDs", () => {
    const policy = { id: "duplicate", name: "Duplicate", enabled: true, rules: [] }
    expect(() => decode([policy, policy])).toThrow(/Duplicate policy ID: duplicate/)
  })

  it("Regex restricts flags and length structurally", () => {
    const decodeRegex = Schema.decodeUnknownOption(Policy.Regex)
    expect(Option.isSome(decodeRegex({ pattern: "sk-[a-z]+", flags: "i" }))).toBe(true)
    expect(Option.isNone(decodeRegex({ pattern: "a", flags: "g" }))).toBe(true)
    expect(Option.isNone(decodeRegex({ pattern: "a".repeat(513) }))).toBe(true)
  })

  it("Definition and Policies reject uncompilable regexes and endpoint rules without a destination", () => {
    const definition = (rule: unknown) => Schema.decodeUnknownOption(Policy.Definition)({ id: "x", name: "x", rules: [rule] })
    expect(Option.isNone(definition({ type: "prompt", match: { pattern: "(" }, replacement: "" }))).toBe(true)
    expect(Option.isNone(definition({ type: "endpoint", model: "a/b" }))).toBe(true)
    expect(Option.isSome(definition({ type: "endpoint", model: "a/b", baseURL: "https://b.example/v1" }))).toBe(true)
    expect(
      Option.isSome(definition({ type: "endpoint", model: "a/*", headers: { authorization: { env: "B_KEY" }, x: "1" } })),
    ).toBe(true)
    expect(() =>
      decode([{ id: "x", name: "x", enabled: true, rules: [{ type: "tool.output", tool: "*", match: { pattern: "[" }, replacement: "" }] }]),
    ).toThrow(/Policy x: Rule 0: invalid regular expression/)
    expect(Policy.issue([{ type: "endpoint", model: "a/b" }])).toBe("Rule 0: endpoint requires baseURL or headers")
    expect(Policy.compile({ pattern: "a+", flags: "i" })?.test("AAA")).toBe(true)
  })

  it("EscalateRule target must be a canonical model resource", () => {
    expect(Option.isSome(decodeRule({ type: "escalate", tool: "scan", target: "anthropic/claude#fast" }))).toBe(true)
    expect(Option.isNone(decodeRule({ type: "escalate", tool: "scan", target: "claude" }))).toBe(true)
    expect(Option.isNone(decodeRule({ type: "escalate", tool: "scan", target: "a/b", purpose: ["bogus"] }))).toBe(true)
  })

  it("Definition keeps enabled optional and decodes every rule kind", () => {
    const decoded = Schema.decodeUnknownOption(Policy.Definition)({
      id: "acme.every-kind",
      name: "Every kind",
      rules: [
        { type: "guardrail", action: "tool.execute", resource: "shell", effect: "allow" },
        { type: "guardrail", action: "tool.execute", resource: "shell", effect: "deny", message: "No" },
        { type: "route", action: "model.request", resource: "a/b", target: "c/d" },
        { type: "endpoint", model: "a/b", baseURL: "https://b.example/v1" },
        { type: "escalate", tool: "scan", target: "c/d" },
        { type: "tool.input", tool: "shell", path: "command", match: { pattern: "rm -rf" } },
        { type: "tool.output", tool: "*", match: { pattern: "secret" }, replacement: "[x]" },
        { type: "instruction", model: "*", text: "Be careful." },
        { type: "prompt", match: { pattern: "AKIA[0-9A-Z]{16}" }, replacement: "[x]" },
      ],
    })
    expect(Option.isSome(decoded)).toBe(true)
    if (Option.isNone(decoded)) return
    expect("enabled" in decoded.value).toBe(false)
    expect(decoded.value.rules.map((rule) => rule.type)).toEqual([
      "guardrail",
      "guardrail",
      "route",
      "endpoint",
      "escalate",
      "tool.input",
      "tool.output",
      "instruction",
      "prompt",
    ])
  })

  it("policy schemas have stable unique identifiers", () => {
    const identifiers = [
      Policy.Pattern,
      Policy.ModelResource,
      Policy.Regex,
      Policy.HeaderValue,
      Policy.Purpose,
      Policy.EndpointRule,
      Policy.EscalateRule,
      Policy.ToolInputRule,
      Policy.ToolOutputRule,
      Policy.InstructionRule,
      Policy.PromptRule,
      Policy.Rule,
      Policy.RuleType,
      Policy.Policy,
      Policy.Definition,
      Policy.Source,
      Policy.Info,
      Policy.Trace,
    ].map((schema) => schema.ast.annotations?.identifier)
    expect(identifiers.every((identifier) => typeof identifier === "string")).toBe(true)
    expect(new Set(identifiers).size).toBe(identifiers.length)
  })
})
