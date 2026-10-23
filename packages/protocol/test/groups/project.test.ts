import { Api } from "@bymorning/protocol/api"
import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { describe, expect, it } from "vitest"

describe("Project protocol", () => {
  it("declares Workspace-authenticated CRUD and expected statuses", () => {
    const endpoints: Array<{ identifier: string; method: string; path: string }> = []
    HttpApi.reflect(Api, {
      onGroup() {},
      onEndpoint({ endpoint, group }) {
        if (group.identifier === "api.project") {
          endpoints.push({ identifier: endpoint.identifier, method: endpoint.method, path: endpoint.path })
        }
      },
    })
    expect(endpoints).toEqual([
      { identifier: "project.create", method: "POST", path: "/api/project" },
      { identifier: "project.list", method: "GET", path: "/api/project" },
      { identifier: "project.get", method: "GET", path: "/api/project/:projectID" },
      { identifier: "project.update", method: "PATCH", path: "/api/project/:projectID" },
      { identifier: "project.delete", method: "DELETE", path: "/api/project/:projectID" },
      { identifier: "project.directory.list", method: "GET", path: "/api/project/:projectID/directory" },
      { identifier: "project.directory.read", method: "GET", path: "/api/project/:projectID/directory/file" },
      { identifier: "project.directory.write", method: "PUT", path: "/api/project/:projectID/directory/file" },
      { identifier: "project.directory.delete", method: "DELETE", path: "/api/project/:projectID/directory/file" },
      { identifier: "project.directory.move", method: "POST", path: "/api/project/:projectID/directory/move" },
    ])
    const paths = OpenApi.fromApi(Api).paths
    expect(Object.keys(paths["/api/project"]?.post?.responses ?? {})).toContain("201")
    expect(Object.keys(paths["/api/project/{projectID}"]?.get?.responses ?? {})).toContain("404")
    expect(Object.keys(paths["/api/project/{projectID}"]?.delete?.responses ?? {})).toContain("204")
    expect(Object.keys(paths["/api/project/{projectID}"]?.patch?.responses ?? {})).toContain("409")
    expect(
      paths["/api/project"]?.get?.parameters?.some((p) => "in" in p && p.in === "query" && p.name === "archived"),
    ).toBe(true)
    expect(Object.keys(paths["/api/project/{projectID}/directory/file"]?.get?.responses ?? {})).toContain("404")
    expect(
      paths["/api/project/{projectID}/directory/file"]?.get?.responses?.["200"]?.content?.["application/octet-stream"]
        ?.schema,
    ).toEqual({ type: "string", format: "binary" })
    expect(Object.keys(paths["/api/project/{projectID}/directory/file"]?.put?.responses ?? {})).toContain("204")
    expect(Object.keys(paths["/api/project/{projectID}/directory/file"]?.put?.requestBody?.content ?? {})).toEqual([
      "application/octet-stream",
    ])
    expect(
      paths["/api/project/{projectID}/directory/file"]?.put?.parameters?.some(
        (parameter) => "in" in parameter && parameter.in === "query" && parameter.name === "path",
      ),
    ).toBe(true)
    expect(Object.keys(paths["/api/project/{projectID}/directory/file"]?.delete?.responses ?? {})).toEqual(
      expect.arrayContaining(["204", "404"]),
    )
    expect(Object.keys(paths["/api/project/{projectID}/directory/move"]?.post?.responses ?? {})).toEqual(
      expect.arrayContaining(["204", "404", "409"]),
    )
  })
})
