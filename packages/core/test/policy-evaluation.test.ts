import type * as Policy from "@bymorning/schema/policy"
import { describe, expect, it } from "vitest"
import { PolicyEvaluation } from "../src/policy/evaluation.js"

describe("PolicyEvaluation", () => {
  it("selects the last matching guardrail and route independently", () => {
    const policies: ReadonlyArray<Policy.Policy> = [
      {
        id: "ordered",
        name: "Ordered",
        enabled: true,
        rules: [
          { type: "guardrail", action: "model.*", resource: "openai/*", effect: "deny", message: "first" },
          { type: "route", action: "model.request", resource: "openai/*", target: "anthropic/first" },
          {
            type: "guardrail",
            action: "model.request",
            resource: "openai/gpt-?",
            effect: "allow",
          },
          { type: "route", action: "model.request", resource: "openai/*", target: "anthropic/last" },
        ],
      },
    ]
    const result = PolicyEvaluation.evaluate("model.request", "openai/gpt-5", policies)
    expect(result.guardrail).toEqual({ effect: "allow" })
    expect(result.route).toBe("anthropic/last")
    expect(result.trace.map(({ matched, selected }) => ({ matched, selected }))).toEqual([
      { matched: true, selected: false },
      { matched: true, selected: false },
      { matched: true, selected: true },
      { matched: true, selected: true },
    ])
    expect(result.trace[2]).toMatchObject({ policyID: "ordered", rule: 2, type: "guardrail" })
  })

  it("allows duplicate patterns, skips disabled policies, and defaults to allow with no route", () => {
    const policies: ReadonlyArray<Policy.Policy> = [
      {
        id: "disabled",
        name: "Disabled",
        enabled: false,
        rules: [{ type: "guardrail", action: "*", resource: "*", effect: "deny" }],
      },
      {
        id: "duplicates",
        name: "Duplicates",
        enabled: true,
        rules: [
          { type: "guardrail", action: "tool.execute", resource: "shell", effect: "deny" },
          { type: "guardrail", action: "tool.execute", resource: "shell", effect: "allow" },
        ],
      },
    ]
    expect(PolicyEvaluation.evaluate("tool.execute", "shell", policies)).toMatchObject({
      guardrail: { effect: "allow" },
    })
    expect(PolicyEvaluation.evaluate("tool.execute", "read", policies)).toEqual({
      guardrail: { effect: "allow" },
      trace: [
        { policyID: "duplicates", rule: 0, type: "guardrail", matched: false, selected: false },
        { policyID: "duplicates", rule: 1, type: "guardrail", matched: false, selected: false },
      ],
    })
  })
})
