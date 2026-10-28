import * as Session from "@bymorning/schema/session"
import * as Project from "@bymorning/schema/project"
import { empty as emptyUsage } from "@bymorning/schema/usage"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

const sessionID = "00000000-0000-4000-8000-000000000001"
const timestamp = "2026-08-10T12:34:56.789Z"
const projectID = Project.ID.create()

describe("Session schemas", () => {
  it("round-trips Info and Detail with canonical timestamp encoding", () => {
    const info = Schema.decodeUnknownSync(Session.Info)({
      id: sessionID,
      projectID,
      title: "New session",
      agent: "build",
      model: { provider: "test", id: "test" },
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    const detail = Session.Detail.make({ ...info, usage: emptyUsage })

    expect(info.createdAt).toEqual(new Date(timestamp))
    expect(Schema.encodeSync(Session.Info)(info)).toEqual({
      id: sessionID,
      projectID,
      title: "New session",
      agent: info.agent,
      model: { provider: "test", id: "test" },
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    expect(Schema.decodeUnknownSync(Session.Detail)(Schema.encodeSync(Session.Detail)(detail))).toEqual(detail)
  })

  it.each([
    [Session.ID, "not-a-uuid"],
    [Session.ListInput, { limit: 0 }],
    [Session.ListInput, { limit: 101 }],
    [Session.ListInput, { cursor: "not/url-safe" }],
    [Session.Title, ""],
    [Session.Title, "x".repeat(256)],
  ])("rejects invalid Session values", (schema, value) => {
    expect(() => Schema.decodeUnknownSync(schema)(value)).toThrow()
  })

  it("rejects unknown fields when strict boundary parsing is requested", () => {
    expect(() =>
      Schema.decodeUnknownSync(Session.ListInput, { onExcessProperty: "error" })({ limit: 1, extra: true }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(Session.Info, { onExcessProperty: "error" })({
        id: sessionID,
        projectID,
        title: "New session",
        activity: "idle",
        agent: "build",
        model: { provider: "test", id: "test" },
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ).toThrow()
  })
})
