import { HttpApi } from "effect/unstable/httpapi"
import { expect, test } from "vitest"
import { Api } from "../../src/api.js"

test("declares the credential operations", () => {
  const endpoints: Array<{ identifier: string; method: string; path: string }> = []
  HttpApi.reflect(Api, {
    onGroup() {},
    onEndpoint({ endpoint, group }) {
      if (group.identifier === "api.credential")
        endpoints.push({ identifier: endpoint.identifier, method: endpoint.method, path: endpoint.path })
    },
  })
  expect(endpoints).toEqual([
    { identifier: "credential.update", method: "PATCH", path: "/api/credential/:credentialID" },
    { identifier: "credential.activate", method: "POST", path: "/api/credential/:credentialID/activate" },
    { identifier: "credential.remove", method: "DELETE", path: "/api/credential/:credentialID" },
  ])
})
