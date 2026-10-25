import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import { CallbackQuery, UnsafeOrigin } from "../src/groups/auth.js"

describe("authentication and Workspace protocol", () => {
  test("decodes callback query and unsafe Origin inputs", () => {
    expect(Schema.decodeUnknownSync(UnsafeOrigin)({})).toEqual({})
    expect(Schema.decodeUnknownSync(UnsafeOrigin)({ origin: "https://app.example" })).toEqual({
      origin: "https://app.example",
    })
    expect(Schema.decodeUnknownSync(CallbackQuery)({ state: "opaque" })).toEqual({ code: "", state: "opaque" })
  })
})
