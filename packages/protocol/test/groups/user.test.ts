import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { expect, test } from "vitest"
import { Api } from "../../src/api.js"

test("declares Workspace member listing and invitation operations", () => {
  const endpoints: Array<{ identifier: string; method: string; path: string }> = []
  HttpApi.reflect(Api, {
    onGroup() {},
    onEndpoint({ endpoint, group }) {
      if (group.identifier === "api.user")
        endpoints.push({ identifier: endpoint.identifier, method: endpoint.method, path: endpoint.path })
    },
  })

  expect(endpoints).toEqual([
    { identifier: "user.list", method: "GET", path: "/api/users" },
    { identifier: "user.invite", method: "POST", path: "/api/users" },
    { identifier: "user.remove", method: "DELETE", path: "/api/users/:userID" },
  ])
})

test("publishes invitation success and availability errors without a conflict response", () => {
  const operation = OpenApi.fromApi(Api).paths["/api/users"]?.post

  expect(operation?.operationId).toBe("api.user.user.invite")
  expect(operation?.responses).toHaveProperty("200")
  expect(operation?.responses).toHaveProperty("403")
  expect(operation?.responses).toHaveProperty("503")
  expect(operation?.responses).not.toHaveProperty("409")
})
