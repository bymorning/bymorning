import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { expect, test } from "vitest"
import { Api } from "../../src/api.js"

test("declares the exact Model policy paths and identifiers", () => {
  const endpoints: Array<string> = []
  HttpApi.reflect(Api, {
    onGroup() {},
    onEndpoint({ endpoint, group }) {
      if (group.identifier === "api.model")
        endpoints.push(`${endpoint.identifier}: ${endpoint.method} ${endpoint.path}`)
    },
  })

  expect(endpoints).toEqual([
    "model.list: GET /api/models",
    "model.auto: GET /api/models/auto",
    "model.route: POST /api/models/route",
    "model.toggle: PUT /api/models/toggle",
    "model.default: PUT /api/models/default",
    "model.create: POST /api/models",
    "model.update: PUT /api/models",
    "model.delete: DELETE /api/models",
  ])
  expect(Object.keys(OpenApi.fromApi(Api).paths).some((path) => path.includes("/models/management"))).toBe(false)
})
