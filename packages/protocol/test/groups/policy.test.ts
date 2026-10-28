import { PolicySimulateSubject, PolicyValidateSubject } from "@bymorning/protocol/groups/policy"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

describe("Policy protocol", () => {
  it("exposes strict validation payloads and canonical simulation actions", () => {
    const decodeValidation = Schema.decodeUnknownSync(PolicyValidateSubject, {
      errors: "all",
      onExcessProperty: "error",
    })
    expect(decodeValidation({ type: "policies", policies: [] }).type).toBe("policies")
    expect(() => decodeValidation({ type: "policies", policies: [], extra: true })).toThrow()

    const decodeSimulation = Schema.decodeUnknownSync(PolicySimulateSubject)
    for (const action of [
      "model.request",
      "provider.request",
      "provider.use",
      "model.use",
      "tool.execute",
      "model.tool",
      "tool.combine",
    ]) {
      expect(decodeSimulation({ action, resource: "*" }).action).toBe(action)
    }
  })
})
