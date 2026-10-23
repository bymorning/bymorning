import { describe, expect, it } from "@effect/vitest"
import { PolicyRoutingKinds } from "../src/policy/kinds/routing.js"

describe("PolicyRoutingKinds", () => {
  it("uses the last matching endpoint", () => {
    expect(
      PolicyRoutingKinds.endpoint(
        [
          {
            policyID: "first",
            rule: 0,
            definition: { type: "endpoint", model: "bymorning/*", baseURL: "https://first.example" },
          },
          {
            policyID: "last",
            rule: 2,
            definition: { type: "endpoint", model: "bymorning/model", headers: { authorization: { env: "TOKEN" } } },
          },
        ],
        "bymorning/model",
      ),
    ).toEqual({ headers: { authorization: { env: "TOKEN" } }, policyID: "last", rule: 2 })
  })

  it("uses the last escalation and defaults purpose to assistant", () => {
    expect(
      PolicyRoutingKinds.escalate(
        [
          {
            policyID: "first",
            rule: 0,
            definition: { type: "escalate", tool: "scan_*", target: "bymorning/first" },
          },
          {
            policyID: "last",
            rule: 1,
            definition: { type: "escalate", tool: "scan_*", target: "bymorning/last" },
          },
        ],
        new Set(["scan_security"]),
        "assistant",
      ),
    ).toEqual({ target: "bymorning/last", tool: "scan_security", policyID: "last", rule: 1 })
    expect(
      PolicyRoutingKinds.escalate(
        [
          {
            policyID: "default",
            rule: 0,
            definition: { type: "escalate", tool: "scan_*", target: "bymorning/default" },
          },
        ],
        new Set(["scan_security"]),
        "title",
      ),
    ).toBeUndefined()
  })

  it("chooses the first matching admitted tool in sorted order", () => {
    expect(
      PolicyRoutingKinds.escalate(
        [
          {
            policyID: "sorted",
            rule: 0,
            definition: { type: "escalate", tool: "scan_*", target: "bymorning/target" },
          },
        ],
        new Set(["scan_z", "scan_a"]),
        "assistant",
      )?.tool,
    ).toBe("scan_a")
  })
})
