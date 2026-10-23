import { Schema } from "effect"
import { expect, test } from "vitest"
import { EmptyInput } from "../src/errors.js"

test("accepts only absent or strict empty mutation payloads", () => {
  expect(Schema.decodeUnknownSync(EmptyInput)(undefined)).toBeUndefined()
  expect(Schema.decodeUnknownSync(EmptyInput)({})).toEqual({})
  expect(() => Schema.decodeUnknownSync(EmptyInput)({ unexpected: true })).toThrow()
})
