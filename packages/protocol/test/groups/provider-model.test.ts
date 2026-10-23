import { OpenApi } from "effect/unstable/httpapi"
import { expect, test } from "vitest"
import { Api } from "../../src/api.js"

test("uses Provider names throughout discovery responses", () => {
  const schemas = OpenApi.fromApi(Api).components.schemas

  expect(schemas?.["Provider.Info"]).toMatchObject({
    properties: { name: { type: "string" } },
    required: ["name", "format", "status"],
  })
  expect(schemas?.["Provider.Info"]).not.toHaveProperty("properties.id")
  expect(schemas?.["Provider.Info"]).toMatchObject({
    properties: { endpointStrategy: { $ref: "#/components/schemas/Provider.EndpointStrategy" } },
  })
  expect(schemas?.["Provider.DirectoryEntry"]).toMatchObject({
    properties: {
      info: { $ref: "#/components/schemas/Provider.Info" },
      integration: { $ref: "#/components/schemas/Integration.Info" },
      active: { type: "boolean" },
      connected: { type: "boolean" },
      connectionCount: { type: "integer" },
      modelCount: { type: "integer" },
    },
  })
  expect(schemas?.["Model.Info"]).toMatchObject({
    properties: { provider: { type: "string" } },
  })
  expect(schemas?.["Model.Info"]).not.toHaveProperty("properties.providerID")
  expect(schemas?.["Model.Info"]).toMatchObject({
    properties: {
      limit: { properties: { context: { type: "number" }, output: { type: "number" } } },
      cost: { required: ["cache"] },
    },
  })
  expect(schemas?.["Model.Management"]).toMatchObject({
    properties: {
      unavailableReason: {
        enum: [
          "provider-inactive",
          "provider-disabled",
          "region-unsupported",
          "transport-unsupported",
          "connection-unavailable",
        ],
      },
    },
  })
})
