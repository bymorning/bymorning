import { describe, expect, it } from "vitest"
import { assertNoUnapprovedRemovals, localModelID } from "../src/identity.js"

describe("identity and removals", () => {
  it("keeps matching source and API identities", () => expect(localModelID("openai", "gpt-5", "gpt-5")).toBe("gpt-5"))
  it("rejects unexplained identity disagreement", () =>
    expect(() => localModelID("openai", "old", "new")).toThrow("without alias"))
  it("strips Fireworks model and router prefixes", () => {
    expect(
      localModelID(
        "fireworks-ai",
        "accounts/fireworks/models/glm-5p2",
        "accounts/fireworks/models/glm-5p2",
      ),
    ).toBe("glm-5p2")
    expect(
      localModelID(
        "fireworks-ai",
        "accounts/fireworks/routers/glm-5p2-fast",
        "accounts/fireworks/routers/glm-5p2-fast",
      ),
    ).toBe("glm-5p2-fast")
  })
  it("requires a removal disposition", () => {
    expect(() => assertNoUnapprovedRemovals(["a", "b"], ["a"], [])).toThrow("b")
    expect(() => assertNoUnapprovedRemovals(["a", "b"], ["a"], ["b"])).not.toThrow()
  })
})
