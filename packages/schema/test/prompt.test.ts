import { Prompt } from "@bymorning/schema/prompt"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"

describe("Prompt schemas", () => {
  test("round-trips Agent mentions with exact source offsets", () => {
    const attachment = {
      name: "agent/id-without-catalog-validation",
      mention: { start: 6, end: 19, text: "@agent/review" },
    }

    expect(
      Schema.encodeSync(Prompt.AgentAttachment)(Schema.decodeUnknownSync(Prompt.AgentAttachment)(attachment)),
    ).toEqual(attachment)
  })
})
