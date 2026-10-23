import { Effect, Exit } from "effect"
import { expect, test } from "vitest"
import * as Output from "../../src/llm-gateway/translation/output.js"
import * as Input from "../../src/llm-gateway/translation/input.js"

test("tool indexes remain contiguous after preceding text and native failure IDs remain stable", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const chat = Output.make("openai-chat", "model", "fixture", 0)
      yield* chat.push({ type: "text-delta", id: "text", text: "Checking" })
      const frames = yield* chat.push({ type: "tool-input-start", id: "call", name: "weather" })
      expect(new TextDecoder().decode(frames[0])).toContain('"tool_calls":[{"index":0')
      const responses = Output.make("openai-responses", "model", "fixture", 0)
      yield* responses.push({ type: "text-delta", id: "text", text: "Checking" })
      expect(responses.failure()).toMatchObject({
        type: "response.failed",
        response: { id: "resp_fixture", status: "failed" },
      })
    }),
  )
})

test("refuses opaque provider reasoning rather than dropping continuation state", async () => {
  const result = await Effect.runPromiseExit(
    Output.make("anthropic-messages", "model", "fixture", 0).push({
      type: "reasoning-delta",
      id: "thought",
      text: "",
      providerMetadata: { bedrock: { signature: "opaque" } },
    }),
  )
  expect(Exit.isFailure(result)).toBe(true)
})

test("Google Tool schemas retain nested types and nullability when lowered to JSON Schema", async () => {
  const input = await Effect.runPromise(
    Input.parse({
      protocol: "google-generate",
      model: "model",
      stream: false,
      body: {
        contents: [{ role: "user", parts: [{ text: "weather" }] }],
        tools: [
          {
            functionDeclarations: [
              {
                name: "weather",
                parameters: {
                  type: "OBJECT",
                  properties: { cities: { type: "ARRAY", items: { type: "STRING", nullable: true } } },
                },
              },
            ],
          },
        ],
      },
    }),
  )
  expect(input.tools).toMatchObject([
    {
      inputSchema: {
        type: "object",
        properties: { cities: { type: "array", items: { anyOf: [{ type: "string" }, { type: "null" }] } } },
      },
    },
  ])
})

test("rejects unsupported nested request controls and unmatched tool results", async () => {
  for (const body of [
    { model: "test", messages: [{ role: "user", content: "hi", name: "custom-name" }] },
    { model: "test", messages: [{ role: "tool", tool_call_id: "missing", content: "result" }] },
    { model: "test", messages: [], tools: [{ type: "function", function: { name: "weather", strict: true } }] },
  ]) {
    const exit = await Effect.runPromiseExit(
      Input.parse({ protocol: "openai-chat", model: "test", stream: false, body }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
  }
})
