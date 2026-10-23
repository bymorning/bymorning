import * as Agent from "@bymorning/schema/agent"
import { Schema } from "effect"
import { expect, test } from "vitest"

test("keeps stable Agent identity distinct from its human-facing name", () => {
  expect(Agent.DefaultID).toBe("default")
  expect(Agent.ID.make("build")).toBe("build")
  // The Workspace ships exactly one primary Agent; the rest are subagents.
  expect([...Agent.BuiltIn]).toEqual(["default", "general", "explore"])
  expect(Agent).not.toHaveProperty("BuildID")
  expect(Agent.Info.fields).toHaveProperty("id")
  expect(Schema.decodeUnknownSync(Agent.Name)("Build")).toBe("Build")
  expect(Schema.decodeUnknownSync(Agent.Name)("build")).toBe("build")
  expect(Schema.decodeUnknownSync(Agent.Name)("AGT_build")).toBe("AGT_build")
  expect(() => Schema.decodeUnknownSync(Agent.Name)("")).toThrow()
  expect(() => Schema.decodeUnknownSync(Agent.Name)("agt_build")).toThrow()
  expect(
    Schema.decodeUnknownSync(Agent.Info, { onExcessProperty: "error" })({
      id: "build",
      name: "Build",
      instructions: "",
      mode: "primary",
      hidden: false,
      steps: null,
      permissions: [],
    }),
  ).toEqual({
    id: "build",
    name: "Build",
    instructions: "",
    mode: "primary",
    hidden: false,
    steps: null,
    permissions: [],
  })
  expect(() => Schema.decodeUnknownSync(Agent.Steps)(0)).toThrow()
  expect(Schema.decodeUnknownSync(Agent.Steps)(2_147_483_647)).toBe(2_147_483_647)
  expect(() => Schema.decodeUnknownSync(Agent.Steps)(2_147_483_648)).toThrow()
})
