import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"

import type { Tool } from "@bymorning/schema/tool"
import { definition } from "../src/tool/runtime.js"

const tool = (input: Tool.ValueSchema): Tool.Info => ({
  name: "example",
  description: "Example",
  input,
  execute: () => Effect.succeed({ content: [] }),
})

describe("Tool runtime definition", () => {
  it("advertises a no-argument Tool as an empty object schema", () => {
    // Effect emits `Schema.Struct({})` as `anyOf: [object, array]`; providers reject inputs without `type: "object"`.
    expect(definition(tool(Schema.Struct({}))).inputSchema).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    })
  })

  it("keeps a typed struct input as is", () => {
    expect(definition(tool(Schema.Struct({ url: Schema.String }))).inputSchema).toMatchObject({
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    })
  })
})
