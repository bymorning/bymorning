import { describe, expect, it } from "vitest"

import { copyToClipboard } from "./clipboard"

describe("copyToClipboard", () => {
  it("writes the value and resolves copied", async () => {
    const written: Array<string> = []
    const clipboard = { writeText: (value: string) => Promise.resolve(void written.push(value)) }
    await expect(copyToClipboard("hello", clipboard)).resolves.toBe("copied")
    expect(written).toEqual(["hello"])
  })

  it("resolves failed when writeText rejects", async () => {
    const clipboard = { writeText: () => Promise.reject(new Error("denied")) }
    await expect(copyToClipboard("hello", clipboard)).resolves.toBe("failed")
  })

  it("resolves unavailable when navigator.clipboard is missing", async () => {
    // jsdom does not implement the clipboard, so the default parameter is undefined.
    await expect(copyToClipboard("hello", undefined)).resolves.toBe("unavailable")
  })
})
