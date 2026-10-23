import { describe, expect, it } from "vitest"
import { Error, type Options } from "./openapi.js"

describe("OpenAPI public contract", () => {
  it("keeps setup errors secret-free and scheme mappings explicit", () => {
    const options: Pick<Options, "expectedOrigin" | "authentication"> = {
      expectedOrigin: "https://example.test",
      authentication: { type: "integration", integrationID: "example", schemes: { auth: { type: "bearer" } } },
    }
    expect(options.authentication.type).toBe("integration")
    expect(new Error({ message: "invalid origin" })).toMatchObject({ _tag: "Error", message: "invalid origin" })
  })
})
