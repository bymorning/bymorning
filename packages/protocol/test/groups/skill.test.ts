import { Api } from "@bymorning/protocol/api"
import { SkillError } from "@bymorning/protocol/errors"
import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { describe, expect, it } from "vitest"

describe("Skill protocol", () => {
  it("declares Workspace-authenticated management CRUD and expected statuses", () => {
    const endpoints: Array<{ identifier: string; method: string; path: string }> = []
    HttpApi.reflect(Api, {
      onGroup() {},
      onEndpoint({ endpoint, group }) {
        if (group.identifier === "api.skill") {
          endpoints.push({ identifier: endpoint.identifier, method: endpoint.method, path: endpoint.path })
        }
      },
    })
    expect(endpoints).toEqual([
      { identifier: "skill.list", method: "GET", path: "/api/skill" },
      { identifier: "skill.get", method: "GET", path: "/api/skill/:skillID" },
      { identifier: "skill.create", method: "POST", path: "/api/skill" },
      { identifier: "skill.update", method: "PUT", path: "/api/skill/:skillID" },
      { identifier: "skill.delete", method: "DELETE", path: "/api/skill/:skillID" },
    ])
    const paths = OpenApi.fromApi(Api).paths
    expect(Object.keys(paths["/api/skill"]?.post?.responses ?? {})).toContain("201")
    expect(Object.keys(paths["/api/skill/{skillID}"]?.get?.responses ?? {})).toContain("404")
    expect(Object.keys(paths["/api/skill/{skillID}"]?.delete?.responses ?? {})).toContain("204")
    expect(new SkillError({ skillID: "skl_missing", message: "missing" })._tag).toBe("Skill.Error")
  })
})
