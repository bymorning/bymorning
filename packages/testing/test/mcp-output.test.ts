import { Tool } from "@bymorning/core/tool"
import { AccountActor } from "@bymorning/schema/actor"
import { Effect, JsonSchema, Schema } from "effect"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { TestMCP } from "../src/mcp.js"

const outputs: ReadonlyArray<{
  readonly name: string
  readonly schema: JsonSchema.JsonSchema
  readonly value: unknown
}> = [
  { name: "unconstrained", schema: {}, value: { answer: 42 } },
  { name: "string", schema: { type: "string" }, value: "hello" },
  { name: "number", schema: { type: "number" }, value: 42 },
  { name: "boolean", schema: { type: "boolean" }, value: false },
  { name: "null", schema: { type: "null" }, value: null },
  { name: "array", schema: { type: "array", items: { type: "string" } }, value: ["hello", "world"] },
  {
    name: "object",
    schema: { type: "object", properties: { answer: { type: "number" } }, required: ["answer"], additionalProperties: false },
    value: { answer: 42 },
  },
]

const pending = {
  type: "object" as const,
  properties: {
    status: { const: "pending" },
    mode: { enum: ["browser", "model"] },
    url: { type: "string" },
    request: { type: "object" },
    continuation: { type: "string" },
  },
  required: ["status", "mode", "continuation"],
}

test("matches inbound MCP output schemas without inventing machine output for content-only Tools", async ({ signal }) => {
  await Effect.runPromise(Effect.gen(function* () {
    const app = yield* TestApp.make()
    const owner = yield* app.login()
    const account = new AccountActor({ type: "account", properties: { accountID: owner.properties.accountID } })
    const config = yield* Effect.tryPromise(() => app.client["api.config"].get())
    yield* Effect.tryPromise(() => app.client["api.config"].update({
      ...config,
      permissions: [{ action: "fixture.output", resource: "*", effect: "allow" }],
    }))
    const tools = yield* app.workspace({ account }, Tool.Service)
    yield* Tool.withSource(tools.transform((editor) => {
      editor.add({
        name: "output_content",
        description: "Content without machine output",
        input: Schema.Struct({}),
        options: { codemode: false, permission: "fixture.output" },
        execute: () => Effect.succeed({
          content: [{ type: "text" as const, text: "content-only result" }],
          metadata: { fixture: "content" },
        }),
      })
      for (const fixture of outputs) {
        editor.add({
          name: `output_${fixture.name}`,
          description: `Declared ${fixture.name} machine output`,
          input: Schema.Struct({}),
          output: fixture.schema,
          options: { codemode: false, permission: "fixture.output" },
          execute: () => Effect.succeed({
            output: fixture.value,
            content: [{ type: "text" as const, text: `${fixture.name} result` }],
            metadata: { fixture: fixture.name },
          }),
        })
      }
      editor.add({
        name: "output_invalid",
        description: "Invalid declared machine output",
        input: Schema.Struct({}),
        output: { type: "string" },
        options: { codemode: false, permission: "fixture.output" },
        execute: () => Effect.succeed({ output: 42 }),
      })
    }), { type: "sdk" }, owner.properties.workspaceID)
    const mcp = yield* TestMCP.connect(app, owner.properties.workspaceID)
    yield* Effect.tryPromise(async () => {
      // listTools installs the real SDK output validators used by callTool below.
      const catalog = await mcp.listTools()
      const content = catalog.tools.find((tool) => tool.name === "output_content")
      expect(content).toBeDefined()
      expect(content).not.toHaveProperty("outputSchema")
      expect(await mcp.callTool({ name: "output_content", arguments: {} })).toEqual({
        content: [{ type: "text", text: "content-only result" }],
        _meta: { fixture: "content" },
      })
      for (const fixture of outputs) {
        const name = `output_${fixture.name}`
        const definition = catalog.tools.find((tool) => tool.name === name)
        const object = fixture.schema.type === "object"
        const result = object
          ? fixture.schema
          : {
              type: "object",
              properties: { output: fixture.schema },
              required: ["output"],
            }
        expect(definition?.outputSchema).toEqual({
          type: "object",
          anyOf: [result, pending],
        })
        expect(await mcp.callTool({ name, arguments: {} })).toEqual({
          content: [{ type: "text", text: `${fixture.name} result` }],
          structuredContent: object ? fixture.value : { output: fixture.value },
          _meta: { fixture: fixture.name },
        })
      }
      const invalid = await mcp.callTool({ name: "output_invalid", arguments: {} })
      expect(invalid.isError).toBe(true)
      expect(invalid).not.toHaveProperty("structuredContent")
      expect(JSON.stringify(invalid.content)).toContain("Tool returned an invalid value for its output schema")
    })
  }).pipe(Effect.scoped), { signal })
})
