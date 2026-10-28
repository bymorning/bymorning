import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import { SessionQuery } from "../../src/groups/session.js"

describe("query codecs", () => {
  test("decode canonical URL integers", () => {
    expect(Schema.decodeUnknownSync(SessionQuery.List)({ limit: "100" })).toEqual({ limit: 100 })
    expect(
      Schema.decodeUnknownSync(SessionQuery.List)({ search: "palette", parentID: "null", archived: "false" }),
    ).toEqual({ search: "palette", parentID: null, archived: false })
  })

  test.each([
    [SessionQuery.List, { limit: "01" }],
    [SessionQuery.List, { limit: "101" }],
  ])("rejects invalid query values", (schema, query) => {
    expect(() => Schema.decodeUnknownSync(schema)(query)).toThrow()
  })
})
