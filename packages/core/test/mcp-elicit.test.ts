import { describe, expect, it } from "vitest"
import { McpElicit } from "../src/mcp/elicit.js"

describe("McpElicit", () => {
  it("converts supported form constraints without weakening them", () => {
    const input = McpElicit.input({
      message: "Provide details",
      requestedSchema: {
        type: "object",
        properties: {
          email: { type: "string", format: "email", minLength: 3, maxLength: 120, pattern: ".+@.+", default: "a@example.com" },
          count: { type: "integer", minimum: 1, maximum: 3, default: 2 },
          choice: { type: "string", enum: ["one", "two"], enumNames: ["One", "Two"] },
        },
        required: ["email", "choice"],
      },
    })
    expect(input).toMatchObject({
      mode: "form",
      fields: [
        { key: "email", type: "string", format: "email", required: true, minLength: 3, maxLength: 120 },
        { key: "count", type: "integer", minimum: 1, maximum: 3 },
        { key: "choice", type: "string", required: true, options: [{ value: "one", label: "One" }, { value: "two", label: "Two" }] },
      ],
    })
  })

  it("uses explicit confirmation for an empty upstream schema", () => {
    const input = McpElicit.input({ message: "Continue?", requestedSchema: { type: "object", properties: {} } })
    expect(input).toMatchObject({ mode: "form", fields: [{ key: "confirmation", type: "string" }] })
  })

  it("rejects unsafe URLs and unsupported schemas", () => {
    expect(() => McpElicit.input({ mode: "url", message: "Open", url: "file:///secret" })).toThrow("Unsupported")
    expect(() => McpElicit.input({ message: "Input", requestedSchema: { type: "object", properties: { nested: { type: "object" } } } })).toThrow("Unsupported")
  })
})
