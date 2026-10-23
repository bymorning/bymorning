import * as InstructionEntry from "@bymorning/schema/instruction-entry"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

describe("InstructionEntry schemas", () => {
  it("accepts exactly slash-free lowercase keys", () => {
    expect(Schema.decodeUnknownSync(InstructionEntry.Key)("build.context-1")).toBe("build.context-1")
    for (const key of ["api/key", "Upper", "_prefix", "space key", ""]) {
      expect(() => Schema.decodeUnknownSync(InstructionEntry.Key)(key)).toThrow()
    }
  })

  it("defines the 8 KiB limit and HTTP 413 typed error", () => {
    expect(InstructionEntry.MaxBytes).toBe(8 * 1024)
    expect(new InstructionEntry.SizeError({ actualBytes: 8193, maxBytes: 8192, message: "too large" })).toMatchObject({
      _tag: "InstructionEntry.SizeError",
      actualBytes: 8193,
      maxBytes: 8192,
    })
  })
})
