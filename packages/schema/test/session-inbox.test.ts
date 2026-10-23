import * as SessionInbox from "@bymorning/schema/session-inbox"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"

const id = "00000000-0000-4000-8000-000000000001"
const sessionID = "00000000-0000-4000-8000-000000000002"
const createdAt = "2026-08-26T12:00:00.000Z"

describe("SessionInbox schemas", () => {
  test("decodes the locked user, synthetic, and compaction item union", () => {
    expect(
      [
        { type: "user", payload: { text: "hello" }, delivery: "queue" },
        {
          type: "synthetic",
          payload: { text: "done", description: "Complete", metadata: { source: "subagent" } },
          delivery: "steer",
        },
        { type: "compaction", payload: {}, delivery: "queue" },
      ].map((item) => Schema.decodeUnknownSync(SessionInbox.Item)(item)),
    ).toHaveLength(3)
  })

  test("round-trips an admitted synthetic item", () => {
    const input = {
      id,
      sessionID,
      type: "synthetic",
      payload: { text: "done", metadata: { state: "completed" } },
      delivery: "steer",
      createdAt,
    }
    expect(Schema.encodeSync(SessionInbox.Synthetic)(Schema.decodeUnknownSync(SessionInbox.Synthetic)(input))).toEqual(
      input,
    )
  })

  test("round-trips user Agent mentions, metadata, and delivery", () => {
    const input = {
      id,
      sessionID,
      admittedSequence: 4,
      type: "user",
      payload: {
        text: "Ask @review without changing this text",
        agents: [{ name: "missing-from-catalog", mention: { start: 4, end: 11, text: "@review" } }],
        metadata: { source: "composer" },
      },
      delivery: "steer",
      createdAt,
    }
    expect(Schema.encodeSync(SessionInbox.Info)(Schema.decodeUnknownSync(SessionInbox.Info)(input))).toEqual(input)
  })

  test("rejects non-JSON synthetic metadata", () => {
    expect(() =>
      Schema.decodeUnknownSync(SessionInbox.SyntheticPayload)({ text: "done", metadata: { invalid: undefined } }),
    ).toThrow()
  })
})
