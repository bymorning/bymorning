import { describe, expect, it } from "vitest"

import { checksum, getCachedMarkdown, touchCachedMarkdown } from "./markdown-cache"

const entry = (raw: string) => ({ raw, hash: checksum(raw), html: `<p>${raw}</p>` })

describe("checksum", () => {
  it("is a stable base36 digest of the text", () => {
    expect(checksum("")).toBe("ztntfp")
    expect(checksum("hello")).toBe("m3bicr")
    expect(checksum("# Hello")).toBe("b9ch2")
    expect(checksum("hello")).toBe(checksum("hello"))
  })
})

describe("touchCachedMarkdown", () => {
  it("stores entries for lookup", () => {
    const value = entry("stored")
    touchCachedMarkdown("cache-store:key", value)
    expect(getCachedMarkdown("cache-store:key")).toEqual(value)
  })

  it("evicts the least recently touched entry beyond the cache limit", () => {
    for (let index = 0; index < 200; index++) touchCachedMarkdown(`cache-lru:${index}`, entry(`lru:${index}`))
    touchCachedMarkdown("cache-lru:0", entry("lru:0"))
    touchCachedMarkdown("cache-lru:200", entry("lru:200"))

    expect(getCachedMarkdown("cache-lru:0")).toBeDefined()
    expect(getCachedMarkdown("cache-lru:1")).toBeUndefined()
    expect(getCachedMarkdown("cache-lru:200")).toBeDefined()
  })
})
