import type { Form } from "@bymorning/schema/form"
import { describe, expect, it } from "vitest"
import { defaults, fieldActive, normalize, validate } from "./form"

describe("Integration form", () => {
  it("applies only non-sensitive defaults and uses the same cascading condition semantics as Core", () => {
    const fields: Form.Field[] = [
      { key: "mode", type: "string", default: "basic" },
      { key: "secret", type: "string", secret: true, default: "defensive-ignore" },
      { key: "terms", type: "external", url: "https://example.com" },
    ]
    expect(defaults(fields)).toEqual({ mode: "basic" })
    expect(
      fieldActive(
        { key: "detail", type: "string", when: [{ key: "mode", op: "eq", value: "advanced" }] },
        { mode: "advanced" },
      ),
    ).toBe(true)
    expect(
      fieldActive({ key: "detail", type: "string", when: [{ key: "mode", op: "neq", value: "advanced" }] }, {}),
    ).toBe(false)
  })

  it("omits stale inactive values through cascading conditions", () => {
    const fields: Form.Field[] = [
      { key: "enabled", type: "boolean" },
      { key: "mode", type: "string", when: [{ key: "enabled", op: "eq", value: true }] },
      { key: "secret", type: "string", when: [{ key: "mode", op: "eq", value: "advanced" }] },
    ]
    expect(normalize(fields, { enabled: false, mode: "advanced", secret: "stale" })).toEqual({ enabled: false })
  })

  it.each<{
    readonly name: string
    readonly fields: ReadonlyArray<Form.Field>
    readonly answer: Record<string, Form.Value | undefined>
    readonly message: string | undefined
  }>([
    {
      name: "required string",
      fields: [{ key: "client", type: "string", required: true }],
      answer: {},
      message: "Missing required form field: client",
    },
    {
      name: "closed option",
      fields: [{ key: "region", type: "string", options: [{ value: "eu", label: "EU" }] }],
      answer: { region: "us" },
      message: "Invalid option for form field: region",
    },
    {
      name: "explicit false required boolean",
      fields: [{ key: "enabled", type: "boolean", required: true }],
      answer: { enabled: false },
      message: undefined,
    },
    {
      name: "multiselect minimum",
      fields: [{ key: "scopes", type: "multiselect", options: [{ value: "read", label: "Read" }], minItems: 1 }],
      answer: { scopes: [] },
      message: "Too few selections for form field: scopes",
    },
    {
      name: "external acknowledgment",
      fields: [{ key: "terms", type: "external", url: "https://example.com" }],
      answer: {},
      message: "External form field must be acknowledged: terms",
    },
    {
      name: "inactive field omitted",
      fields: [
        { key: "mode", type: "string" },
        {
          key: "detail",
          type: "string",
          required: true,
          when: [{ key: "mode", op: "eq", value: "advanced" }],
        },
      ],
      answer: { mode: "basic" },
      message: undefined,
    },
  ])("validates $name", ({ fields, answer, message }) => {
    expect(validate(fields, answer)).toBe(message)
  })
})
