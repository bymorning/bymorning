import { describe, expect, it } from "vitest"
import { canonical } from "../src/sync.js"

describe("offline generation", () => {
  it("is deterministic regardless of object insertion order", () => {
    expect(canonical({ z: 1, a: { y: 2, x: 3 } })).toBe(canonical({ a: { x: 3, y: 2 }, z: 1 }))
  })
})
