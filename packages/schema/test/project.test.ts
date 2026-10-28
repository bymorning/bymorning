import * as Project from "@bymorning/schema/project"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

describe("Project schemas", () => {
  it("creates only canonical namespaced IDs", () => {
    expect(Project.ID.create()).toMatch(/^prj_/)
    expect(() => Project.ID.make("global")).toThrow()
  })

  it("round-trips icon and nonnegative millisecond time metadata", () => {
    const value = Schema.decodeUnknownSync(Project.Info)({
      id: Project.ID.create(),
      name: "Default",
      icon: { url: "https://example.com/icon.svg", color: "#fff" },
      time_created: 0,
      time_updated: 42,
    })
    expect(Schema.encodeSync(Project.Info)(value)).toEqual({
      id: value.id,
      name: "Default",
      icon: { url: "https://example.com/icon.svg", color: "#fff" },
      time_created: 0,
      time_updated: 42,
    })
    expect(() => Schema.decodeUnknownSync(Project.Info)({ ...value, time_created: -1 })).toThrow()
    expect(() => Schema.decodeUnknownSync(Project.Info)({ ...value, time_updated: 0.5 })).toThrow()
  })

  it("preserves omitted patch fields and accepts null clears", () => {
    const projectID = Project.ID.create()
    expect(Schema.decodeUnknownSync(Project.UpdateInput)({ projectID })).toEqual({ projectID })
    expect(Schema.decodeUnknownSync(Project.UpdateInput)({ projectID, name: null, icon: null })).toEqual({
      projectID,
      name: null,
      icon: null,
    })
  })

  it("requires absolute paths for current Project context", () => {
    const id = Project.ID.create()
    expect(Schema.decodeUnknownSync(Project.Current)({ id, directory: "/repo/sub", canonical: "/repo" })).toEqual({
      id,
      directory: "/repo/sub",
      canonical: "/repo",
    })
    expect(() => Schema.decodeUnknownSync(Project.Current)({ id, directory: "repo", canonical: "/repo" })).toThrow()
  })
})
