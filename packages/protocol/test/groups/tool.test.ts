import { Schema } from "effect"
import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { describe, expect, test } from "vitest"
import { Api } from "../../src/api.js"
import { ToolUsageQuery } from "../../src/groups/tool.js"

describe("Tool protocol", () => {
  test("declares only the Tool usage list operation", () => {
    const endpoints: Array<{ identifier: string; method: string; path: string }> = []
    HttpApi.reflect(Api, {
      onGroup() {},
      onEndpoint({ endpoint, group }) {
        if (group.identifier !== "api.tool") return
        endpoints.push({ identifier: endpoint.identifier, method: endpoint.method, path: endpoint.path })
      },
    })

    expect(endpoints).toEqual([{ identifier: "tool.usage.list", method: "GET", path: "/api/tool/usage" }])
  })

  test("decodes the list query and enforces its bounds", () => {
    const workspace = "wrk_workspace"
    const userID = "usr_user"
    const sessionID = "00000000-0000-4000-8000-000000000000"

    expect(
      Schema.decodeUnknownSync(ToolUsageQuery)({
        workspace,
        cursor: "base64url_-",
        limit: "100",
        userID,
        sessionID,
      }),
    ).toEqual({ workspace, cursor: "base64url_-", limit: 100, userID, sessionID })
    expect(() => Schema.decodeUnknownSync(ToolUsageQuery)({})).toThrow()
    expect(() => Schema.decodeUnknownSync(ToolUsageQuery)({ workspace, cursor: "not base64url" })).toThrow()
    expect(() => Schema.decodeUnknownSync(ToolUsageQuery)({ workspace, limit: "0" })).toThrow()
    expect(() => Schema.decodeUnknownSync(ToolUsageQuery)({ workspace, limit: "101" })).toThrow()
  })

  test("publishes the query, page, and declared errors", () => {
    const operation = OpenApi.fromApi(Api).paths["/api/tool/usage"]?.get

    expect(operation?.operationId).toBe("api.tool.tool.usage.list")
    expect(operation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "workspace", in: "query", required: true }),
        expect.objectContaining({ name: "cursor", in: "query", required: false }),
        expect.objectContaining({ name: "limit", in: "query", required: false }),
        expect.objectContaining({ name: "userID", in: "query", required: false }),
        expect.objectContaining({ name: "sessionID", in: "query", required: false }),
      ]),
    )
    expect(Object.keys(operation?.responses ?? {})).toEqual(["200", "400", "401", "403", "500", "503"])
    expect(operation?.responses["200"]).toMatchObject({
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ToolUsage.Page" },
        },
      },
    })
    const record = OpenApi.fromApi(Api).components.schemas["ToolUsage.ListRecord"]
    expect(record).toMatchObject({
      required: ["id", "userID", "sessionID", "tool", "status", "occurredAt"],
      properties: { sessionID: { anyOf: expect.arrayContaining([{ type: "null" }]) } },
    })
  })
})
