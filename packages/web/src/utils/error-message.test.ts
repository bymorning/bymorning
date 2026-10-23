import { describe, expect, it } from "vitest"

import { errorMessage } from "./error-message"

describe("errorMessage", () => {
  it("returns the message of an Error", () => {
    expect(errorMessage(new Error("boom"), "fallback")).toBe("boom")
  })

  it("returns the fallback for a string cause", () => {
    expect(errorMessage("nope", "fallback")).toBe("fallback")
  })

  it("returns the fallback for null and undefined causes", () => {
    expect(errorMessage(null, "fallback")).toBe("fallback")
    expect(errorMessage(undefined, "fallback")).toBe("fallback")
  })

  it("uses the fallback for an Error with an empty message", () => {
    expect(errorMessage(new Error(""), "fallback")).toBe("fallback")
  })

  it("reads the error field of a Protocol.InputError", () => {
    const cause = Object.assign(new Error(""), { error: "Account was not found" })
    expect(errorMessage(cause, "fallback")).toBe("Account was not found")
  })

  it("uses the fallback for a transport ClientError", () => {
    const cause = new Error("UnexpectedStatus")
    cause.name = "ClientError"
    expect(errorMessage(cause, "fallback")).toBe("fallback")
  })

  it("reads message from a plain object", () => {
    expect(errorMessage({ message: "Plain failure" }, "fallback")).toBe("Plain failure")
  })

  it("reads error from a plain object without a message", () => {
    expect(errorMessage({ error: "Input rejected" }, "fallback")).toBe("Input rejected")
  })

  it("falls through a blank message to error", () => {
    expect(errorMessage({ message: "  ", error: "Input rejected" }, "fallback")).toBe("Input rejected")
  })

  it("uses the fallback for whitespace-only fields", () => {
    expect(errorMessage({ message: "   ", error: "\n" }, "fallback")).toBe("fallback")
  })

  it("ignores non-string fields", () => {
    expect(errorMessage({ message: 42, error: { nested: true } }, "fallback")).toBe("fallback")
  })
})
