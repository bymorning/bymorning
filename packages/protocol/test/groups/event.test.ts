import { Schema } from "effect"
import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { expect, test } from "vitest"
import { Api } from "../../src/api.js"
import { WorkspaceEventQuery } from "../../src/groups/event.js"

test("accepts only the Workspace selector on the live Event stream", () => {
  expect(Schema.decodeUnknownSync(WorkspaceEventQuery)({})).toEqual({})
  expect(
    Schema.decodeUnknownSync(WorkspaceEventQuery)({ workspace: "wrk_event" }),
  ).toEqual({ workspace: "wrk_event" })
})

test("publishes one non-replayable Event endpoint", () => {
  const endpoints: Array<string> = []
  HttpApi.reflect(Api, {
    onGroup() {},
    onEndpoint({ endpoint, group }) {
      if (group.identifier === "api.event") endpoints.push(endpoint.identifier)
    },
  })
  expect(endpoints).toEqual(["event.subscribe"])

  const operation = OpenApi.fromApi(Api).paths["/api/event"]?.get
  expect(operation).toMatchObject({ operationId: "v2.event.subscribe", summary: "Subscribe to events" })
  expect(operation?.description).toContain("not replayed")
  expect(OpenApi.fromApi(Api).paths["/api/event/session"]).toBeUndefined()
})
