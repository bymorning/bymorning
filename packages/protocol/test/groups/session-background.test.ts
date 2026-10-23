import { HttpApi, HttpApiMiddleware, OpenApi } from "effect/unstable/httpapi"
import { describe, expect, test } from "vitest"
import { makeSessionGroup } from "../../src/groups/session.js"

class WorkspaceMiddleware extends HttpApiMiddleware.Service<WorkspaceMiddleware, { provides: never }>()(
  "test/BackgroundWorkspaceMiddleware",
) {}

class PersistedSessionMiddleware extends HttpApiMiddleware.Service<PersistedSessionMiddleware, { provides: never }>()(
  "test/BackgroundPersistedSessionMiddleware",
) {}

const api = HttpApi.make("test").add(makeSessionGroup(WorkspaceMiddleware, PersistedSessionMiddleware))

describe("Session background protocol", () => {
  test("publishes the payload-free 204 contract", () => {
    const operation = OpenApi.fromApi(api).paths["/api/session/{sessionID}/background"]?.post
    expect(operation?.requestBody).toBeUndefined()
    expect(Object.keys(operation?.responses ?? {})).toEqual(["204", "400", "404", "500"])
  })
})
