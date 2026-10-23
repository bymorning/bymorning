import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { expect, test } from "vitest"
import { AgentGroup } from "../../src/groups/agent.js"

const api = HttpApi.make("test").add(AgentGroup)

test("declares exact Agent management paths and identifiers", () => {
  const endpoints: Array<{ identifier: string; method: string; path: string }> = []
  HttpApi.reflect(api, {
    onGroup() {},
    onEndpoint({ endpoint, group }) {
      if (group.identifier === "api.agent")
        endpoints.push({ identifier: endpoint.identifier, method: endpoint.method, path: endpoint.path })
    },
  })
  expect(endpoints).toEqual([
    { identifier: "agent.list", method: "GET", path: "/api/agent" },
    { identifier: "agent.get", method: "GET", path: "/api/agent/:id" },
    { identifier: "agent.create", method: "POST", path: "/api/agent" },
    { identifier: "agent.update", method: "PUT", path: "/api/agent/:id" },
    { identifier: "agent.delete", method: "DELETE", path: "/api/agent/:id" },
  ])

  const paths = OpenApi.fromApi(api).paths
  expect(paths["/api/agent/{id}"]?.get?.responses).toHaveProperty("404")
  expect(paths["/api/agent"]?.post?.responses).toHaveProperty("201")
  expect(paths["/api/agent"]?.post?.responses).toHaveProperty("400")
  expect(paths["/api/agent"]?.post?.responses).toHaveProperty("409")
  expect(paths["/api/agent"]?.post?.requestBody).toMatchObject({
    required: true,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Agent.Info" } } },
  })
  expect(paths["/api/agent/events"]).toBeUndefined()
  expect(paths["/api/agent/{id}"]?.put?.requestBody).toBeDefined()
  expect(paths["/api/agent/{id}"]?.put?.responses).toHaveProperty("400")
  expect(paths["/api/agent/{id}"]?.put?.responses).toHaveProperty("404")
  expect(paths["/api/agent/{id}"]?.delete?.responses).toHaveProperty("204")
  expect(paths["/api/agent/{id}"]?.delete?.responses).toHaveProperty("404")
  expect(paths["/api/agent/{id}"]?.delete?.requestBody).toBeUndefined()
})
