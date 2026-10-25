import * as Model from "@bymorning/schema/model"
import { Schema } from "effect"
import { expect, test } from "vitest"

test("preserves unknown model prices instead of synthesizing zero", () => {
  const cost = Schema.decodeUnknownSync(Model.Cost)({ cache: {} })

  expect(cost).toEqual({ cache: {} })
  expect(cost).not.toHaveProperty("input")
  expect(cost).not.toHaveProperty("output")
})
