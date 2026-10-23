import { Message as SessionMessage } from "@bymorning/schema/message"
import { Message } from "@opencode-ai/ai/schema/messages"
import { Effect, Ref, Schema, Stream } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { request } from "@opencode-ai/ai/llm"
import { LLMClient } from "@opencode-ai/ai/route/client"
import { RequestExecutor } from "@opencode-ai/ai/route/executor"
import { Auth } from "@opencode-ai/ai/route/auth"
import { configure } from "@opencode-ai/ai/providers/openai-compatible"
import { AIError, InvalidRequestError } from "@opencode-ai/ai/schema/errors"
import { describe, expect, test } from "vitest"
import { serialize } from "../../src/session/compaction.js"
import { fromHistory } from "../../src/session/provider-message.js"
import { Routing } from "../../src/routing.js"

const synthetic = Schema.decodeUnknownSync(SessionMessage)({
  id: "00000000-0000-4000-8000-000000000001",
  sessionID: "00000000-0000-4000-8000-000000000002",
  sequence: 1,
  type: "synthetic",
  text: "Background work completed",
  description: "Research complete",
  metadata: { source: "subagent", childID: "child" },
  createdAt: "2026-08-26T12:00:00.000Z",
})
const user = Schema.decodeUnknownSync(SessionMessage)({
  id: "00000000-0000-4000-8000-000000000003",
  sessionID: "00000000-0000-4000-8000-000000000002",
  sequence: 2,
  type: "user",
  text: "Ask @unknown-agent exactly as written",
  agents: [{ name: "unknown-agent", mention: { start: 4, end: 18, text: "@unknown-agent" } }],
  metadata: { source: "composer" },
  delivery: "steer",
  admittedSequence: 1,
  createdAt: "2026-08-26T12:00:00.000Z",
})

describe("synthetic provider messages", () => {
  test("lowers only model-visible text as a user message, tagged so Routing skips it as an ask", () => {
    const lowered = fromHistory([synthetic])
    expect(lowered).toEqual([
      { role: "user", content: [{ type: "text", text: "Background work completed" }], metadata: { synthetic: true } },
    ])
    const digest = Routing.digest(lowered)
    expect(digest.ask).toBe("")
    expect(digest.human).toBe(false)
  })

  test("serializes synthetic context distinctly for compaction", () => {
    expect(serialize(synthetic)).toBe("[Synthetic context]: Background work completed")
  })

  test("preserves visible text and carries Agent mentions in provider metadata", () => {
    expect(fromHistory([user])).toEqual([
      {
        id: user.id,
        role: "user",
        content: [{ type: "text", text: "Ask @unknown-agent exactly as written" }],
        metadata: {
          source: "composer",
          agents: [{ name: "unknown-agent", mention: { start: 4, end: 18, text: "@unknown-agent" } }],
        },
      },
    ])
  })
})

describe("compaction provider messages", () => {
  const compaction = Schema.decodeUnknownSync(SessionMessage)({
    id: "00000000-0000-4000-8000-000000000005",
    sessionID: "00000000-0000-4000-8000-000000000002",
    sequence: 3,
    type: "compaction",
    reason: "auto",
    status: "completed",
    summary: "The work so far",
    recent: "last turns",
    createdAt: "2026-08-26T12:00:00.000Z",
  })

  test("lowers a completed compaction to a checkpoint the digest never treats as an ask", () => {
    const lowered = fromHistory([user, compaction])
    expect(lowered.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "<conversation-checkpoint>\nThe work so far\n\nlast turns\n</conversation-checkpoint>" }],
    })
    const digest = Routing.digest(lowered)
    expect(digest.ask).toBe("Ask @unknown-agent exactly as written")
    expect(digest.human).toBe(false)
    const resumed = Routing.digest([...lowered, Message.user("continue please")])
    expect(resumed.ask).toBe("continue please")
    expect(resumed.history).toEqual(["Ask @unknown-agent exactly as written"])
    expect(resumed.human).toBe(true)
  })
})

describe("local tool provider messages", () => {
  test("keeps interrupted history paired without synthesizing results or changing call identities", async () => {
    const assistant = Schema.decodeUnknownSync(SessionMessage)({
      id: "00000000-0000-4000-8000-000000000004",
      sessionID: user.sessionID,
      sequence: 1,
      type: "assistant",
      agent: "build",
      model: { provider: "bymorning", id: "test" },
      content: [
        {
          type: "tool",
          id: "incomplete",
          name: "lookup",
          state: { status: "streaming", input: '{"query":' },
          time: { created: "2026-08-26T12:00:00.000Z" },
        },
        {
          type: "tool",
          id: "cancelled-call",
          name: "lookup",
          state: {
            status: "error",
            input: { query: "first" },
            error: { _tag: "SessionError.AbortedError", message: "Cancelled by the user" },
          },
          time: { created: "2026-08-26T12:00:00.000Z", completed: "2026-08-26T12:00:01.000Z" },
        },
      ],
      usage: { cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
      time: { created: "2026-08-26T12:00:00.000Z" },
      createdAt: "2026-08-26T12:00:00.000Z",
    })
    const messages = fromHistory([assistant, user])
    expect(messages[0]).toMatchObject({
      content: [{ type: "tool-call", id: "cancelled-call", name: "lookup", input: { query: "first" } }],
    })
    expect(messages[1]).toMatchObject({
      content: [
        {
          type: "tool-result",
          id: "cancelled-call",
          name: "lookup",
          result: { type: "error", value: "Cancelled by the user" },
        },
      ],
    })
    const body = await Effect.runPromise(
      Effect.gen(function* () {
        const captured = yield* Ref.make<HttpClientRequest.HttpClientRequest | undefined>(undefined)
        const stopped = new AIError({ reason: new InvalidRequestError({ message: "Captured without network IO" }) })
        const model = configure({ provider: "fixture", baseURL: "https://fixture.invalid", auth: Auth.none }).model(
          "test",
        )
        const failure = yield* LLMClient.stream(request({ model, messages })).pipe(
          Stream.runDrain,
          Effect.flip,
          Effect.provide(LLMClient.layer),
          Effect.provideService(RequestExecutor.Service, {
            execute: (physical) => Ref.set(captured, physical).pipe(Effect.andThen(Effect.fail(stopped))),
          }),
        )
        expect(failure).toEqual(stopped)
        const physical = yield* Ref.get(captured)
        if (physical?.body._tag !== "Uint8Array") return yield* Effect.die("Expected JSON request")
        return new TextDecoder().decode(physical.body.body)
      }),
    )
    expect(body).not.toContain("Tool result missing")
    expect(body).not.toContain("incomplete")
    expect(JSON.parse(body)).toMatchObject({
      messages: [
        {
          role: "assistant",
          tool_calls: [{ id: "cancelled-call", function: { name: "lookup", arguments: '{"query":"first"}' } }],
        },
        { role: "tool", tool_call_id: "cancelled-call", content: "Cancelled by the user" },
        { role: "user" },
      ],
    })
  })

  test("replays bounded content and durable metadata without archived output", () => {
    const history = Schema.decodeUnknownSync(SessionMessage)({
      id: "00000000-0000-4000-8000-000000000003",
      sessionID: "00000000-0000-4000-8000-000000000002",
      sequence: 2,
      type: "assistant",
      agent: "build",
      model: { provider: "bymorning", id: "test" },
      content: [
        {
          type: "tool",
          id: "local",
          name: "large",
          state: {
            status: "completed",
            input: {},
            content: [{ type: "text", text: "bounded" }],
            result: { archived: "full output" },
            metadata: { source: "local", truncated: true, outputID: "out_test" },
          },
          time: {
            created: "2026-08-26T12:00:00.000Z",
            ran: "2026-08-26T12:00:00.000Z",
            completed: "2026-08-26T12:00:00.000Z",
          },
        },
      ],
      usage: { cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
      time: { created: "2026-08-26T12:00:00.000Z" },
      createdAt: "2026-08-26T12:00:00.000Z",
    })

    const replay = fromHistory([history])
    expect(replay[1]).toMatchObject({
      role: "tool",
      content: [
        {
          type: "tool-result",
          result: { type: "content", value: [{ type: "text", text: "bounded" }] },
          metadata: { source: "local", truncated: true, outputID: "out_test" },
        },
      ],
    })
    expect(JSON.stringify(replay[1])).not.toContain("full output")
  })
})

describe("continuation replay", () => {
  const assistant = Schema.decodeUnknownSync(SessionMessage)({
    id: "00000000-0000-4000-8000-000000000010",
    sessionID: "00000000-0000-4000-8000-000000000002",
    sequence: 3,
    type: "assistant",
    agent: "build",
    model: { provider: "opencode", id: "gpt-5.5" },
    content: [
      {
        type: "reasoning",
        id: "part-reasoning",
        text: "Thinking",
        providerMetadata: { openai: { itemId: "rs_1", reasoningEncryptedContent: "gAAA" } },
        time: { created: "2026-08-26T12:00:00.000Z" },
      },
      {
        type: "text",
        id: "part-text",
        text: "Calling a tool",
        providerMetadata: { openai: { itemId: "msg_1" } },
        time: { created: "2026-08-26T12:00:00.000Z" },
      },
      {
        type: "tool",
        id: "call_1",
        name: "lookup",
        providerMetadata: { openai: { itemId: "fc_1" } },
        state: { status: "completed", input: { query: "x" }, content: [{ type: "text", text: "found" }] },
        time: { created: "2026-08-26T12:00:00.000Z", completed: "2026-08-26T12:00:01.000Z" },
      },
    ],
    usage: { cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
    time: { created: "2026-08-26T12:00:00.000Z" },
    createdAt: "2026-08-26T12:00:00.000Z",
  })

  test("replays opaque provider state by default", () => {
    const [message] = fromHistory([assistant])
    expect(JSON.stringify(message)).toContain("reasoningEncryptedContent")
    expect(message?.content).toHaveLength(3)
  })

  test("replays only the visible conversation when continuation is refused", () => {
    const [message, tool] = fromHistory([assistant], { continuation: false })
    const text = JSON.stringify(message)
    expect(text).not.toContain("reasoningEncryptedContent")
    expect(text).not.toContain("rs_1")
    expect(text).not.toContain("fc_1")
    expect(message?.content.map((part) => part.type)).toEqual(["text", "tool-call"])
    expect(tool?.role).toBe("tool")
  })

  test("keeps continuation state for the Model that issued it", () => {
    const [message] = fromHistory([assistant], { model: { provider: "opencode", id: "gpt-5.5" } })
    expect(JSON.stringify(message)).toContain("reasoningEncryptedContent")
  })

  test("drops continuation state issued by a different routed Model", () => {
    const [message, tool] = fromHistory([assistant], { model: { provider: "anthropic", id: "claude-sonnet-5" } })
    const text = JSON.stringify(message)
    expect(text).not.toContain("reasoningEncryptedContent")
    expect(text).not.toContain("fc_1")
    expect(message?.content.map((part) => part.type)).toEqual(["text", "tool-call"])
    expect(tool?.role).toBe("tool")
  })
})
