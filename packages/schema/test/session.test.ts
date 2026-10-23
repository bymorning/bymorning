import * as Session from "@bymorning/schema/session"
import * as Agent from "@bymorning/schema/agent"
import * as Model from "@bymorning/schema/model"
import * as Message from "@bymorning/schema/message"
import * as Provider from "@bymorning/schema/provider"
import * as Project from "@bymorning/schema/project"
import { empty as emptyUsage } from "@bymorning/schema/usage"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

const sessionID = "00000000-0000-4000-8000-000000000001"
const messageID = "00000000-0000-4000-8000-000000000002"
const timestamp = "2026-08-10T12:34:56.789Z"
const projectID = Project.ID.create()

describe("Session schemas", () => {
  it("reuses canonical identity and prompt field schemas", () => {
    expect(Session.ID).toBe(Session.Info.fields.id)
    expect(Session.PromptInput.fields.id).toBe(Message.Input.fields.id)
    expect(Session.PromptInput.fields.text).toBe(Schema.String)
    expect(
      Schema.decodeUnknownSync(Session.CompactInput)({ sessionID, id: Message.ID.make(messageID) }).sessionID,
    ).toBe(sessionID)
    expect(Schema.decodeUnknownSync(Session.CompactInput)({ sessionID }).sessionID).toBe(sessionID)
  })

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

  it("decodes list pages and bounded inputs", () => {
    const input = Schema.decodeUnknownSync(Session.ListInput)({ cursor: "eyJ2IjoxfQ", limit: 100 })
    const info = Session.Info.make({
      id: Session.ID.make(sessionID),
      projectID,
      title: "New session",
      agent: Agent.DefaultID,
      model: Model.Ref.make({ provider: Provider.Name.make("test"), id: "test" }),
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
    })

    expect(input).toEqual({ cursor: "eyJ2IjoxfQ", limit: 100 })
    expect(Session.Page.make({ data: [info] }).data).toEqual([info])
  })

  it("decodes canonical summary, creation, and filtered-list contracts", () => {
    const parentID = Session.ID.make(messageID)
    const agent = Agent.ID.make("review")
    const model = Model.Ref.make({ provider: Provider.Name.make("selected"), id: "selected" })
    const info = Schema.decodeUnknownSync(Session.Info)({
      id: sessionID,
      projectID,
      parentID,
      title: "Investigate sessions",
      archivedAt: timestamp,
      agent: "build",
      model: { provider: "test", id: "test" },
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    expect(info).toMatchObject({ parentID, title: "Investigate sessions" })
    expect(info.archivedAt).toEqual(new Date(timestamp))
    expect(Schema.decodeUnknownSync(Session.CreateInput)({ projectID, agent, model })).toEqual({
      projectID,
      agent,
      model,
    })
    expect(
      Schema.decodeUnknownSync(Session.ListInput)({ search: "sessions", parentID: null, archived: false, limit: 50 }),
    ).toEqual({ search: "sessions", parentID: null, archived: false, limit: 50 })
    expect(
      Schema.decodeUnknownSync(Session.UpdateInput)({
        sessionID,
        title: "Renamed",
        projectID,
        archived: true,
      }),
    ).toEqual({ sessionID, title: "Renamed", projectID, archived: true })
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
