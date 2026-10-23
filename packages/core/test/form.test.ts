import { Form } from "../src/form.js"
import { describe, expect, it } from "vitest"

describe("Form declarations", () => {
  it("rejects secret string defaults without rejecting ordinary defaults", () => {
    expect(Form.validateFields([{ key: "secret", type: "string", secret: true, default: "must-not-persist" }])).toBe(
      "Secret form field cannot have a default: secret",
    )
    expect(Form.validateFields([{ key: "region", type: "string", default: "eu" }])).toBeUndefined()
    expect(Form.validateFields([{ key: "enabled", type: "boolean", default: false }])).toBeUndefined()
    expect(Form.validateFields([{ key: "secret", type: "string", secret: true, multiline: true }])).toBe(
      "Secret form field cannot be multiline: secret",
    )
    expect(Form.validateFields([{ key: "document", type: "string", multiline: true }])).toBeUndefined()
  })
})
