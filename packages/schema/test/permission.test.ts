import * as Permission from "@bymorning/schema/permission"
import { Schema } from "effect"
import { expect, test } from "vitest"

test("retains OpenCode-compatible empty Permission strings and arrays", () => {
  expect(Schema.decodeUnknownSync(Permission.Ruleset)([{ action: "", resource: "", effect: "ask" }])).toEqual([
    { action: "", resource: "", effect: "ask" },
  ])
  expect(Permission.ID.create()).toMatch(/^per_/)
  expect(Permission.SavedID.create()).toMatch(/^psv_/)
})
