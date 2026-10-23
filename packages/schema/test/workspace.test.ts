import * as Workspace from "@bymorning/schema/workspace"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

describe("Workspace.Info", () => {
  const decode = Schema.decodeUnknownSync(Workspace.Info)
  const workspace = { id: Workspace.ID.create(), name: "Default", status: "active" }

  it("accepts a 1-255 character inline name", () => {
    expect(decode(workspace)).toEqual(workspace)
    expect(decode({ ...workspace, name: "x".repeat(255) }).name).toHaveLength(255)
  })

  it("rejects missing, empty, and overlong names", () => {
    expect(() => decode({ id: workspace.id, status: workspace.status })).toThrow()
    expect(() => decode({ ...workspace, name: "" })).toThrow()
    expect(() => decode({ ...workspace, name: "x".repeat(256) })).toThrow()
  })
})
