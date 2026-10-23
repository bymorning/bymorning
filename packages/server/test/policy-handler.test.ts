import * as PolicySchema from "@bymorning/schema/policy"
import { describe, expect, it } from "vitest"
import { validatePolicyInput } from "../src/handlers/policy.js"

const definition = PolicySchema.Policy.make({ id: "safe", name: "Safe", enabled: true, rules: [] })

describe("Policy handler", () => {
  it("validates closed policy arrays and reports duplicate IDs", () => {
    expect(validatePolicyInput({ type: "policies", policies: [definition] })).toEqual({ valid: true, issues: [] })
    expect(validatePolicyInput({ type: "policies", policies: [definition], extra: true }).valid).toBe(false)
    const duplicate = validatePolicyInput({ type: "policies", policies: [definition, definition] })
    expect(duplicate.valid).toBe(false)
    expect(duplicate.issues[0]?.message).toContain("Duplicate policy ID: safe")
  })
})
