import { Schema } from "effect"
import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { describe, expect, test } from "vitest"
import { Api } from "../../src/api.js"
import { SessionQuery } from "../../src/groups/session.js"

describe("Session protocol", () => {
  test("declares the complete authoritative endpoint surface", () => {
    const endpoints: Array<{ identifier: string; method: string; path: string }> = []
    HttpApi.reflect(Api, {
      onGroup() {},
      onEndpoint({ endpoint, group }) {
        if (group.identifier !== "api.session") return
        endpoints.push({
          identifier: endpoint.identifier,
          method: endpoint.method,
          path: endpoint.path,
        })
      },
    })

    expect(endpoints).toEqual([
      { identifier: "session.create", method: "POST", path: "/api/session" },
      { identifier: "session.list", method: "GET", path: "/api/session" },
      { identifier: "session.active", method: "GET", path: "/api/session/active" },
      { identifier: "session.get", method: "GET", path: "/api/session/:sessionID" },
      { identifier: "session.update", method: "PATCH", path: "/api/session/:sessionID" },
      { identifier: "session.delete", method: "DELETE", path: "/api/session/:sessionID" },
      {
        identifier: "session.inbox.list",
        method: "GET",
        path: "/api/session/:sessionID/inbox",
      },
      {
        identifier: "session.prompt",
        method: "POST",
        path: "/api/session/:sessionID/prompt",
      },
      {
        identifier: "session.compact",
        method: "POST",
        path: "/api/session/:sessionID/compact",
      },
      {
        identifier: "session.interrupt",
        method: "POST",
        path: "/api/session/:sessionID/interrupt",
      },
      {
        identifier: "session.background",
        method: "POST",
        path: "/api/session/:sessionID/background",
      },
      {
        identifier: "session.switchAgent",
        method: "POST",
        path: "/api/session/:sessionID/agent",
      },
      {
        identifier: "session.switchModel",
        method: "POST",
        path: "/api/session/:sessionID/model",
      },
      { identifier: "session.rename", method: "POST", path: "/api/session/:sessionID/rename" },
      {
        identifier: "session.command",
        method: "POST",
        path: "/api/session/:sessionID/command",
      },
      {
        identifier: "session.synthetic",
        method: "POST",
        path: "/api/session/:sessionID/synthetic",
      },
      { identifier: "session.wait", method: "POST", path: "/api/session/:sessionID/wait" },
      {
        identifier: "session.generate",
        method: "POST",
        path: "/api/session/:sessionID/generate",
      },
      {
        identifier: "session.entry.list",
        method: "GET",
        path: "/api/session/:sessionID/instructions/entries",
      },
      {
        identifier: "session.entry.put",
        method: "PUT",
        path: "/api/session/:sessionID/instructions/entries/:key",
      },
      {
        identifier: "session.entry.remove",
        method: "DELETE",
        path: "/api/session/:sessionID/instructions/entries/:key",
      },
    ])
  })

  test("declares statuses, errors, payloads, query fields, and SSE media type", () => {
    const paths = OpenApi.fromApi(Api).paths

    expect(Object.keys(paths["/api/session"]?.post?.responses ?? {})).toEqual([
      "201",
      "400",
      "401",
      "403",
      "404",
      "409",
      "500",
      "503",
    ])
    expect(paths["/api/session"]?.post?.requestBody).toMatchObject({
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              projectID: { type: "string" },
              agent: { type: "string" },
              model: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  provider: { type: "string" },
                  variant: { type: "string" },
                },
                required: ["id", "provider"],
              },
            },
            required: ["projectID"],
            additionalProperties: false,
          },
        },
      },
    })
    expect(Object.keys(paths["/api/session/{sessionID}/prompt"]?.post?.responses ?? {})).toEqual([
      "202",
      "400",
      "401",
      "403",
      "404",
      "409",
      "500",
      "503",
    ])
    expect(paths["/api/session"]?.get?.parameters?.map((parameter) => parameter.name)).toEqual([
      "cursor",
      "limit",
      "search",
      "parentID",
      "archived",
      "workspace",
    ])
    expect(paths["/api/session/active"]?.get?.parameters?.map((parameter) => parameter.name)).toEqual(["workspace"])
    expect(paths["/api/session/active"]?.get?.requestBody).toBeUndefined()
    expect(Object.keys(paths["/api/session/active"]?.get?.responses ?? {})).toEqual([
      "200",
      "400",
      "401",
      "403",
      "500",
      "503",
    ])
    expect(paths["/api/session/active"]?.get?.responses["200"]).toMatchObject({
      content: { "application/json": { schema: { $ref: "#/components/schemas/SessionActiveMap" } } },
    })
    const schemas = OpenApi.fromApi(Api).components.schemas
    expect(schemas).toMatchObject({
      SessionActiveMap: { type: "object" },
      SessionActive: {
        type: "object",
        properties: { type: { type: "string", enum: ["running"] } },
        required: ["type"],
        additionalProperties: false,
      },
    })
    expect(Object.values(schemas.SessionActiveMap?.patternProperties ?? {})).toEqual([
      { $ref: "#/components/schemas/SessionActive" },
    ])
    expect(Object.keys(paths["/api/session/{sessionID}/compact"]?.post?.responses ?? {})).toEqual([
      "202",
      "400",
      "401",
      "403",
      "404",
      "409",
      "500",
      "503",
    ])
    expect(paths["/api/session/{sessionID}/compact"]?.post?.requestBody).toMatchObject({
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: { id: { type: "string" } },
            additionalProperties: false,
          },
        },
      },
    })
    expect(paths["/api/session/{sessionID}/compact"]?.post?.responses["409"]?.description).toContain(
      "Session.CompactionConflictError",
    )
    expect(paths["/api/session/{sessionID}"]?.patch?.requestBody).toMatchObject({
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              projectID: { type: "string" },
              archived: { type: "boolean" },
            },
            additionalProperties: false,
          },
        },
      },
    })
    expect(Object.keys(paths["/api/session/{sessionID}"]?.patch?.responses ?? {})).toEqual([
      "200",
      "400",
      "401",
      "403",
      "404",
      "500",
      "503",
    ])
    expect(Object.keys(paths["/api/session/{sessionID}"]?.delete?.responses ?? {})).toEqual([
      "204",
      "400",
      "401",
      "403",
      "404",
      "500",
      "503",
    ])
    expect(Object.keys(paths["/api/session/{sessionID}/interrupt"]?.post?.responses ?? {})).toEqual([
      "204",
      "400",
      "401",
      "403",
      "404",
      "500",
      "503",
    ])
    expect(paths["/api/session/{sessionID}/background"]?.post?.requestBody).toBeUndefined()
    expect(Object.keys(paths["/api/session/{sessionID}/background"]?.post?.responses ?? {})).toEqual([
      "204",
      "400",
      "401",
      "403",
      "404",
      "500",
      "503",
    ])
    expect(paths["/api/session/{sessionID}/inbox"]?.get?.parameters?.map((parameter) => parameter.name)).toEqual([
      "sessionID",
    ])
    expect(paths["/api/session/{sessionID}/prompt"]?.post?.requestBody).toMatchObject({
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              id: { type: "string" },
              text: { type: "string" },
              agents: { type: "array", items: { $ref: "#/components/schemas/Prompt.AgentAttachment" } },
              metadata: { type: "object" },
              delivery: { $ref: "#/components/schemas/Session.Inbox.Delivery" },
              resume: { type: "boolean" },
            },
            required: ["text"],
            additionalProperties: false,
          },
        },
      },
    })
    expect(Object.keys(paths["/api/session/{sessionID}/agent"]?.post?.responses ?? {})).toEqual([
      "204",
      "400",
      "401",
      "403",
      "404",
      "500",
      "503",
    ])
    expect(Object.keys(paths["/api/session/{sessionID}/model"]?.post?.responses ?? {})).toEqual([
      "204",
      "400",
      "401",
      "403",
      "404",
      "500",
      "503",
    ])
    expect(paths["/api/session/{sessionID}/synthetic"]?.post?.requestBody).toMatchObject({
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              id: { type: "string" },
              text: { type: "string" },
              description: { type: "string" },
              metadata: { type: "object" },
              delivery: { $ref: "#/components/schemas/Session.Inbox.Delivery" },
              resume: { type: "boolean" },
            },
            required: ["text"],
            additionalProperties: false,
          },
        },
      },
    })
    expect(Object.keys(paths["/api/session/{sessionID}/synthetic"]?.post?.responses ?? {})).toEqual([
      "200",
      "400",
      "401",
      "403",
      "404",
      "409",
      "500",
      "503",
    ])
  })
})

describe("query codecs", () => {
  test("decode canonical URL integers", () => {
    expect(Schema.decodeUnknownSync(SessionQuery.List)({ limit: "100" })).toEqual({ limit: 100 })
    expect(
      Schema.decodeUnknownSync(SessionQuery.List)({ search: "palette", parentID: "null", archived: "false" }),
    ).toEqual({ search: "palette", parentID: null, archived: false })
  })

  test.each([
    [SessionQuery.List, { limit: "01" }],
    [SessionQuery.List, { limit: "101" }],
  ])("rejects invalid query values", (schema, query) => {
    expect(() => Schema.decodeUnknownSync(schema)(query)).toThrow()
  })
})
