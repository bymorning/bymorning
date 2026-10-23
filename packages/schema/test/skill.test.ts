import * as Skill from "@bymorning/schema/skill"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

describe("Skill", () => {
  it("creates ascending prefixed IDs", () => {
    const first = Skill.ID.create()
    const second = Skill.ID.create()

    expect(first).toMatch(/^skl_[0-9A-Za-z]{26}$/)
    expect(second > first).toBe(true)
  })

  it("accepts stable kebab-case IDs", () => {
    expect(Skill.ID.make("custom-skill")).toBe("custom-skill")
    expect(() => Skill.ID.make("Custom Skill")).toThrow()
  })

  it("derives Create from Info without accepting an ID", () => {
    const input = { name: "Review", description: "Reviews changes", instructions: "Inspect carefully" }

    expect(Schema.decodeUnknownSync(Skill.Create)(input)).toEqual(input)
    expect(Schema.decodeUnknownSync(Skill.Create)({ ...input, id: Skill.ID.create() })).toEqual(input)
    expect(() => Schema.decodeUnknownSync(Skill.Create)({ ...input, name: "" })).toThrow()
  })
})
