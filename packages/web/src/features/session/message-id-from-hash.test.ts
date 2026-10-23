import { describe, expect, it } from "vitest"

import { messageIDFromHash } from "./message-id-from-hash"

describe("messageIDFromHash", () => {
  it("parses hashes with and without the leading marker", () => {
    expect(messageIDFromHash("#message-abc123")).toBe("abc123")
    expect(messageIDFromHash("message-42")).toBe("42")
  })

  it("ignores non-message anchors", () => {
    expect(messageIDFromHash("#review-panel")).toBeUndefined()
  })
})
