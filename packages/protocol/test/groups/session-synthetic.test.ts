import { HttpApi, HttpApiMiddleware, OpenApi } from "effect/unstable/httpapi"
import { describe, expect, test } from "vitest"
import { makeSessionGroup } from "../../src/groups/session.js"

class WorkspaceMiddleware extends HttpApiMiddleware.Service<WorkspaceMiddleware, { provides: never }>()(
  "test/SyntheticWorkspaceMiddleware",
) {}

class PersistedSessionMiddleware extends HttpApiMiddleware.Service<PersistedSessionMiddleware, { provides: never }>()(
  "test/SyntheticPersistedSessionMiddleware",
) {}

const api = HttpApi.make("test").add(makeSessionGroup(WorkspaceMiddleware, PersistedSessionMiddleware))

describe("Session synthetic protocol", () => {
  test("publishes the locked admission contract", () => {
    const operation = OpenApi.fromApi(api).paths["/api/session/{sessionID}/synthetic"]?.post
    expect(operation?.requestBody).toMatchObject({
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
    expect(Object.keys(operation?.responses ?? {})).toEqual(["200", "400", "404", "409", "500"])
  })
})
