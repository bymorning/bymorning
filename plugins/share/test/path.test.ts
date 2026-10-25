import { describe, expect, it } from "vitest"
import { shareRouteHref } from "../src/web/path.js"

describe("shareRouteHref", () => {
  it("builds the share href outside the workspace prefix", () => {
    expect(shareRouteHref("wrk_1", "tok/avec espace")).toBe("/s/wrk_1/tok%2Favec%20espace")
  })
})
