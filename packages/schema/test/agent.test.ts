import * as Agent from "@bymorning/schema/agent"
import { Schema } from "effect"
import { expect, test } from "vitest"

test("validates Agent names, strict Info decoding, and step bounds", () => {
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
