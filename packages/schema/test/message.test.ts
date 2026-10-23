import * as Message from "@bymorning/schema/message"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

const sessionID = "00000000-0000-4000-8000-000000000001"
const userID = "00000000-0000-4000-8000-000000000002"
const assistantID = "00000000-0000-4000-8000-000000000003"
const timestamp = "2026-08-10T12:34:56.789Z"

describe("Message schemas", () => {
  it("round-trips the reduced OpenCode user and assistant shapes", () => {
    const user = Schema.decodeUnknownSync(Message.User)({
      id: userID,
      sessionID,
      sequence: 1,
      type: "user",
      text: "Hello @review",
      agents: [{ name: "review", mention: { start: 6, end: 13, text: "@review" } }],
      metadata: { source: "test" },
      delivery: "steer",
      admittedSequence: 1,
      createdAt: timestamp,
    })
    const assistant = Schema.decodeUnknownSync(Message.Assistant)({
      id: assistantID,
      sessionID,
      sequence: 2,
      type: "assistant",
      agent: "build",
      model: { id: "deepseek-v4-flash", provider: "legacy" },
      content: [
        { type: "reasoning", id: "r1", text: "Think", providerMetadata: { openai: "opaque" } },
        { type: "text", id: "t1", text: "Hi" },
        {
          type: "tool",
          id: "c1",
          name: "read",
          time: { created: timestamp },
          state: {
            status: "completed",
            input: { path: "/tmp/a" },
            content: [],
            result: { lines: 1 },
          },
        },
      ],
      finish: "tool-calls",
      time: { created: timestamp, streamed: timestamp, completed: timestamp },
      retry: {
        attempt: 2,
        at: timestamp,
        error: { _tag: "SessionError.ProviderError", message: "retrying" },
      },
      usage: {
        cost: 0,
        costComplete: true,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      createdAt: timestamp,
    })
    expect(Schema.decodeUnknownSync(Message.Message)(Schema.encodeSync(Message.Message)(user))).toEqual(user)
    expect(Schema.decodeUnknownSync(Message.Message)(Schema.encodeSync(Message.Message)(assistant))).toEqual(assistant)
  })

  it("supports empty in-progress assistants and rejects legacy split Tool parts", () => {
    expect(
      Schema.decodeUnknownSync(Message.Assistant)({
        id: assistantID,
        sessionID,
        sequence: 1,
        type: "assistant",
        agent: "build",
        model: { id: "m", provider: "legacy" },
        content: [],
        time: { created: timestamp },
        usage: { cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
        createdAt: timestamp,
      }).content,
    ).toEqual([])
    expect(() =>
      Schema.decodeUnknownSync(Message.AssistantPart)({ type: "tool-call", id: "c", name: "x", input: {} }),
    ).toThrow()
  })

  it("preserves routed model provenance while accepting historical assistants without it", () => {
    const encoded = {
      id: assistantID,
      sessionID,
      sequence: 1,
      type: "assistant",
      agent: "build",
      model: { id: "gpt-5.6-terra", provider: "bymorning" },
      requestedModel: { id: "gpt-5.6-sol", provider: "bymorning" },
      content: [],
      time: { created: timestamp },
      usage: {
        cost: 0,
        costComplete: true,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      createdAt: timestamp,
    }
    expect(Schema.encodeSync(Message.Message)(Schema.decodeUnknownSync(Message.Message)(encoded))).toEqual(encoded)
    const { requestedModel: _, ...historical } = encoded
    expect(Schema.decodeUnknownSync(Message.Assistant)(historical).requestedModel).toBeUndefined()
  })

  it("round-trips durable system updates", () => {
    const system = Schema.decodeUnknownSync(Message.Message)({
      id: assistantID,
      sessionID,
      sequence: 2,
      type: "system",
      text: "Skill guidance changed",
      description: "Instructions updated: core/skill-instructions",
      createdAt: timestamp,
    })
    expect(system).toMatchObject({
      type: "system",
      text: "Skill guidance changed",
      description: "Instructions updated: core/skill-instructions",
    })
    expect(Schema.encodeSync(Message.Message)(system)).toMatchObject({
      type: "system",
      text: "Skill guidance changed",
      description: "Instructions updated: core/skill-instructions",
    })
  })

  it("round-trips synthetic context with client-only metadata", () => {
    const synthetic = Schema.decodeUnknownSync(Message.Message)({
      id: assistantID,
      sessionID,
      sequence: 2,
      type: "synthetic",
      text: "Background work completed",
      description: "Research complete",
      metadata: { source: "subagent", childID: "child" },
      createdAt: timestamp,
    })
    expect(Schema.encodeSync(Message.Message)(synthetic)).toMatchObject({
      type: "synthetic",
      text: "Background work completed",
      description: "Research complete",
      metadata: { source: "subagent", childID: "child" },
    })
  })

  it("round-trips running, completed, and failed compactions", () => {
    const fixtures = [
      { status: "running", reason: "manual", summary: "Partial", recent: "Recent context" },
      { status: "completed", reason: "auto", summary: "Summary", recent: "Recent context" },
      {
        status: "failed",
        reason: "manual",
        error: { _tag: "SessionError.ProviderError", message: "failed" },
      },
    ] as const
    for (const [index, fixture] of fixtures.entries()) {
      const encoded = {
        id: assistantID,
        sessionID,
        sequence: index + 1,
        type: "compaction",
        createdAt: timestamp,
        ...fixture,
      }
      expect(Schema.encodeSync(Message.Message)(Schema.decodeUnknownSync(Message.Message)(encoded))).toEqual(encoded)
    }
  })

  it("decodes immutable historical assistants without fabricating Agent or Usage", () => {
    const encoded = {
      id: assistantID,
      sessionID,
      sequence: 1,
      type: "assistant",
      model: { id: "legacy", provider: "legacy" },
      content: [],
      time: { created: timestamp },
      createdAt: timestamp,
    }
    const decoded = Schema.decodeUnknownSync(Message.Message)(encoded)
    expect(decoded).not.toHaveProperty("agent")
    expect(decoded).not.toHaveProperty("usage")
    expect(decoded).not.toHaveProperty("retry")
    expect(Schema.encodeSync(Message.Message)(decoded)).toEqual(encoded)
    expect(() => Schema.decodeUnknownSync(Message.Assistant)(encoded)).toThrow()
  })

  it("rejects empty IDs for current assistant parts while decoding historical empty IDs", () => {
    const encoded = {
      id: assistantID,
      sessionID,
      sequence: 1,
      type: "assistant",
      agent: "build",
      model: { id: "legacy", provider: "legacy" },
      content: [{ type: "text", id: "", text: "historical" }],
      time: { created: timestamp },
      usage: { cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
      createdAt: timestamp,
    }
    expect(() => Schema.decodeUnknownSync(Message.Assistant)(encoded)).toThrow()
    expect(Schema.decodeUnknownSync(Message.Message)(encoded)).toMatchObject({ content: [{ id: "" }] })
  })

  it("accepts prompt text and validates pagination bounds", () => {
    expect(Schema.decodeUnknownSync(Message.Input)({ id: userID, text: "Hello" }).text).toBe("Hello")
    expect(Schema.decodeUnknownSync(Message.Input)({ id: userID, text: "" }).text).toBe("")
    expect(Schema.decodeUnknownSync(Message.Input)({ id: userID, text: "x".repeat(8_001) }).text).toHaveLength(8_001)
    expect(
      Schema.decodeUnknownSync(Message.Input)({
        text: "Ask @uncatalogued",
        agents: [{ name: "uncatalogued", mention: { start: 4, end: 16, text: "@uncatalogued" } }],
        metadata: { source: "test" },
      }),
    ).toEqual({
      text: "Ask @uncatalogued",
      agents: [{ name: "uncatalogued", mention: { start: 4, end: 16, text: "@uncatalogued" } }],
      metadata: { source: "test" },
    })
    expect(() => Schema.decodeUnknownSync(Message.ListInput)({ sessionID, limit: 0 })).toThrow()
  })
})
