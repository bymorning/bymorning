import { Api } from "@bymorning/protocol/api"
import { PolicySimulateSubject, PolicyValidateSubject } from "@bymorning/protocol/groups/policy"
import { Schema } from "effect"
import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { describe, expect, it } from "vitest"

describe("Policy protocol", () => {
  it("declares Workspace inventory, managed CRUD, enablement, validation, and simulation endpoints", () => {
    const endpoints: Array<{ identifier: string; method: string; path: string }> = []
    HttpApi.reflect(Api, {
      onGroup() {},
      onEndpoint({ endpoint, group }) {
        if (group.identifier === "api.policy")
          endpoints.push({ identifier: endpoint.identifier, method: endpoint.method, path: endpoint.path })
      },
    })

    expect(endpoints).toEqual([
      { identifier: "policy.list", method: "GET", path: "/api/policy" },
      { identifier: "policy.create", method: "POST", path: "/api/policy" },
      { identifier: "policy.update", method: "PUT", path: "/api/policy/:policyID" },
      { identifier: "policy.delete", method: "DELETE", path: "/api/policy/:policyID" },
      { identifier: "policy.setEnabled", method: "PUT", path: "/api/policy/:policyID/enabled" },
      { identifier: "policy.validate", method: "POST", path: "/api/policy/validate" },
      { identifier: "policy.simulate", method: "POST", path: "/api/policy/simulate" },
    ])

    const paths = OpenApi.fromApi(Api).paths
    expect(Object.keys(paths["/api/policy/{policyID}"] ?? {}).sort()).toEqual(["delete", "put"])
    expect(Object.keys(paths["/api/policy/{policyID}/enabled"] ?? {})).toEqual(["put"])
    expect(paths["/api/project/{projectID}/policy/{policyID}"]).toBeUndefined()
  })

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
