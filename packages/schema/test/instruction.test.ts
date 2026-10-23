import * as Instruction from "@bymorning/schema/instruction"
import { Schema } from "effect"
import { describe, expect, expectTypeOf, it } from "vitest"

describe("Instruction schemas", () => {
  it("accepts stable source keys and lowercase SHA-256 hashes", () => {
    const key = Schema.decodeUnknownSync(Instruction.Key)("core/skill-instructions")
    const hash = Schema.decodeUnknownSync(Instruction.Hash)("a".repeat(64))
    expect(Schema.decodeUnknownSync(Instruction.Values)({ [key]: hash })).toEqual({ [key]: hash })
    expect(Schema.decodeUnknownSync(Instruction.Delta)({ [key]: "removed" })).toEqual({ [key]: "removed" })
    expectTypeOf<keyof Instruction.Values>().toEqualTypeOf<Instruction.Key>()
    expectTypeOf<keyof Instruction.Delta>().toEqualTypeOf<Instruction.Key>()
  })

  it("rejects malformed keys and hashes", () => {
    expect(() => Schema.decodeUnknownSync(Instruction.Key)("skill")).toThrow()
    expect(() => Schema.decodeUnknownSync(Instruction.Hash)("A".repeat(64))).toThrow()
    expect(() => Schema.decodeUnknownSync(Instruction.Hash)("a".repeat(63))).toThrow()
  })
})
