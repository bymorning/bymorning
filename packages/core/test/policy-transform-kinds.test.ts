import { describe, expect, it } from "@effect/vitest"
import type { Policy } from "../src/policy.js"
import { PolicyTransformKinds } from "../src/policy/kinds/transform.js"

describe("PolicyTransformKinds", () => {
  it("denies tool input matching a path regex", () => {
    const selected: ReadonlyArray<Policy.Selected<"tool.input">> = [
      {
        policyID: "dangerous-input",
        rule: 2,
        definition: { type: "tool.input", tool: "sh*", path: "command", match: { pattern: "rm -rf" } },
      },
    ]
    expect(PolicyTransformKinds.toolInput(selected, "shell", { command: "rm -rf /" })).toEqual({
      policyID: "dangerous-input",
      rule: 2,
    })
  })

  it("does not match a missing path", () => {
    const selected: ReadonlyArray<Policy.Selected<"tool.input">> = [
      {
        policyID: "dangerous-input",
        rule: 0,
        definition: { type: "tool.input", tool: "shell", path: "missing.value", match: { pattern: ".*" } },
      },
    ]
    expect(PolicyTransformKinds.toolInput(selected, "shell", { command: "rm -rf /" })).toBeUndefined()
  })

  it("redacts tool output text content and string output", () => {
    const selected: ReadonlyArray<Policy.Selected<"tool.output">> = [
      {
        policyID: "secrets",
        rule: 1,
        definition: { type: "tool.output", tool: "*", match: { pattern: "secret" }, replacement: "[redacted]" },
      },
    ]
    expect(
      PolicyTransformKinds.toolOutput(selected, "shell", {
        content: [{ type: "text", text: "secret and secret" }],
        output: "secret",
      }),
    ).toEqual({
      result: { content: [{ type: "text", text: "[redacted] and [redacted]" }], output: "[redacted]" },
      applied: [{ policyID: "secrets", rule: 1 }],
    })
  })

  it("structured output objects are not traversed", () => {
    const selected: ReadonlyArray<Policy.Selected<"tool.output">> = [
      {
        policyID: "secrets",
        rule: 0,
        definition: { type: "tool.output", tool: "*", match: { pattern: "secret" }, replacement: "[redacted]" },
      },
    ]
    const output = { token: "secret" }
    expect(PolicyTransformKinds.toolOutput(selected, "shell", { output })).toEqual({ result: { output }, applied: [] })
  })

  it("instructions match model and agent patterns", () => {
    const selected: ReadonlyArray<Policy.Selected<"instruction">> = [
      {
        policyID: "instructions",
        rule: 0,
        definition: { type: "instruction", model: "anthropic/*", agent: "build*", text: "Matched" },
      },
      {
        policyID: "instructions",
        rule: 1,
        definition: { type: "instruction", model: "openai/*", text: "Not matched" },
      },
    ]
    expect(PolicyTransformKinds.instructions(selected, "anthropic/sonnet", "builder")).toEqual([
      { text: "Matched", policyID: "instructions", rule: 0 },
    ])
  })

  it("prompt applies every rule in order", () => {
    const selected: ReadonlyArray<Policy.Selected<"prompt">> = [
      {
        policyID: "prompt",
        rule: 0,
        definition: { type: "prompt", match: { pattern: "secret" }, replacement: "token" },
      },
      {
        policyID: "prompt",
        rule: 1,
        definition: { type: "prompt", match: { pattern: "token" }, replacement: "[redacted]" },
      },
    ]
    expect(PolicyTransformKinds.prompt(selected, "secret secret")).toEqual({
      text: "[redacted] [redacted]",
      applied: [
        { policyID: "prompt", rule: 0 },
        { policyID: "prompt", rule: 1 },
      ],
    })
  })
})
