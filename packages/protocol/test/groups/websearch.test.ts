import { HttpApi } from "effect/unstable/httpapi"
import { expect, test } from "vitest"
import { Api } from "../../src/api.js"

test("declares the websearch operations", () => {
  const endpoints: Array<{ identifier: string; method: string; path: string }> = []
  HttpApi.reflect(Api, {
    onGroup() {},
    onEndpoint({ endpoint, group }) {
      if (group.identifier === "api.websearch")
        endpoints.push({ identifier: endpoint.identifier, method: endpoint.method, path: endpoint.path })
    },
  })
  expect(endpoints).toEqual([
    { identifier: "websearch.providers", method: "GET", path: "/api/websearch/provider" },
    { identifier: "websearch.query", method: "POST", path: "/api/websearch" },
  ])
})
