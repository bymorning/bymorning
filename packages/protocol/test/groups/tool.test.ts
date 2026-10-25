import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import { ToolUsageQuery } from "../../src/groups/tool.js"

describe("Tool protocol", () => {
  test("decodes the list query and enforces its bounds", () => {
    const workspace = "wrk_workspace"
    const userID = "usr_user"
    const sessionID = "00000000-0000-4000-8000-000000000000"

    expect(
      Schema.decodeUnknownSync(ToolUsageQuery)({
        workspace,
        cursor: "base64url_-",
        limit: "100",
        userID,
        sessionID,
      }),
    ).toEqual({ workspace, cursor: "base64url_-", limit: 100, userID, sessionID })
    expect(() => Schema.decodeUnknownSync(ToolUsageQuery)({})).toThrow()
    expect(() => Schema.decodeUnknownSync(ToolUsageQuery)({ workspace, cursor: "not base64url" })).toThrow()
    expect(() => Schema.decodeUnknownSync(ToolUsageQuery)({ workspace, limit: "0" })).toThrow()
    expect(() => Schema.decodeUnknownSync(ToolUsageQuery)({ workspace, limit: "101" })).toThrow()
  })
})
