import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { describe, expect, test } from "vitest"
import { Api } from "../../src/api.js"

describe("Usage protocol", () => {
  test("keeps pagination transport-local", () => {
    const endpoints: Array<{ identifier: string; method: string; path: string }> = []
    HttpApi.reflect(Api, {
      onGroup() {},
      onEndpoint({ endpoint, group }) {
        if (group.identifier !== "api.usage") return
        endpoints.push({ identifier: endpoint.identifier, method: endpoint.method, path: endpoint.path })
      },
    })

    expect(endpoints).toEqual([
      { identifier: "usage.list", method: "GET", path: "/api/usage" },
      { identifier: "usage.records", method: "GET", path: "/api/usage/records" },
      { identifier: "usage.overview", method: "GET", path: "/api/usage/overview" },
      { identifier: "usage.leaderboard", method: "GET", path: "/api/usage/leaderboard" },
    ])
  })

  test("requires a supported overview window", () => {
    const operation = OpenApi.fromApi(Api).paths["/api/usage/overview"]?.get

    expect(operation?.operationId).toBe("api.usage.usage.overview")
    expect(operation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "workspace", in: "query", required: false }),
        expect.objectContaining({ name: "days", in: "query", required: true }),
      ]),
    )
    expect(operation?.responses).toHaveProperty("200")
    expect(operation?.responses).toHaveProperty("400")
    expect(operation?.responses).toHaveProperty("500")
  })
})
