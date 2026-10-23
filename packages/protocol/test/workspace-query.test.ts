import { OpenApi } from "effect/unstable/httpapi"
import { describe, expect, test } from "vitest"
import { Api } from "../src/api.js"

describe("Workspace query composition", () => {
  const paths = OpenApi.fromApi(Api).paths

  test("adds an optional selector to generic Workspace resource operations", () => {
    for (const [path, item] of Object.entries(paths)) {
      // Public share views carry the Workspace in the path. Account-scoped
      // (login sessions, OAuth grants) and Installation-scoped (Auth Providers,
      // License, Installation Admins and Policy, Account suspension) resources
      // have no Workspace at all.
      if (!path.startsWith("/api/") || path === "/api/workspaces") continue
      if (/^\/api\/(public|accounts?|auth-provider|license|installation)(\/|$)/.test(path)) continue
      for (const operation of Object.values(item)) {
        if (operation === undefined || typeof operation !== "object" || !("responses" in operation)) continue
        if (path === "/api/tool/usage") {
          expect(operation.parameters, path).toContainEqual(
            expect.objectContaining({ in: "query", name: "workspace", required: true }),
          )
          continue
        }
        // OAuth consent is account-bound; approval selects its Workspace in the payload.
        if (
          path.includes("/session/{sessionID}") ||
          ["/api/oauth/request", "/api/oauth/approve", "/api/oauth/deny"].includes(path)
        ) {
          expect(operation.parameters ?? [], path).not.toContainEqual(
            expect.objectContaining({ in: "query", name: "workspace" }),
          )
          continue
        }
        expect(operation.parameters, path).toContainEqual(
          expect.objectContaining({ in: "query", name: "workspace", required: false }),
        )
      }
    }
  })

  test("preserves the model query field", () => {
    expect(paths["/api/models"]?.get?.parameters?.map(({ name }) => name)).toEqual(["workspace", "provider"])
    expect(paths["/api/models/toggle"]?.put?.parameters?.map(({ name }) => name)).toEqual(["workspace"])
    expect(paths["/api/models/default"]?.put?.parameters?.map(({ name }) => name)).toEqual(["workspace"])
  })

  test("removes retired ModelDefinition and Route resources", () => {
    expect(paths["/api/model-definitions"]).toBeUndefined()
    // Routing preview lives under models; the retired per-Session Route resource is gone.
    expect(Object.keys(paths).filter((path) => path.endsWith("/route"))).toEqual(["/api/models/route"])
  })
})
