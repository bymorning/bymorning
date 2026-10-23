import type { LLMGateway } from "@bymorning/schema/llm-gateway"
import { describe, expect, test } from "vitest"
import { digest } from "../../src/llm-gateway/route.js"

const request = (protocol: LLMGateway.Protocol, body: unknown) =>
  ({ protocol, model: "auto/general", stream: false, body }) as LLMGateway.Request

describe("Gateway routing digest", () => {
  test("Anthropic: a user turn holding only tool results and reminders continues the ask", () => {
    const ask = { role: "user", content: [{ type: "text", text: "Refactor the auth module" }] }
    const opening = digest(request("anthropic-messages", { system: "You are Claude Code.", messages: [ask] }))
    const step = digest(
      request("anthropic-messages", {
        system: "You are Claude Code.",
        messages: [
          ask,
          { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { path: "auth.ts" } }] },
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "toolu_1", content: "export const auth = 1" },
              { type: "text", text: "<system-reminder>Remember the todo list</system-reminder>" },
            ],
          },
        ],
      }),
    )
    expect(opening).toMatchObject({ ask: "Refactor the auth module", human: true })
    expect(step).toMatchObject({ ask: "Refactor the auth module", human: false })
    expect(step.turn).toBe(opening.turn)
  })

  test("Anthropic: participant text written beside tool results is a new ask", () => {
    const next = digest(
      request("anthropic-messages", {
        messages: [
          { role: "user", content: "Refactor the auth module" },
          { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: {} }] },
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "toolu_1", content: "ok" },
              { type: "text", text: "Actually, stop and explain the design first" },
            ],
          },
        ],
      }),
    )
    expect(next).toMatchObject({ ask: "Actually, stop and explain the design first", human: true })
    expect(next.history).toEqual(["Refactor the auth module"])
  })

  test("OpenAI Responses: function call output continues the ask; instructions are system text", () => {
    const input = [{ role: "user", content: [{ type: "input_text", text: "Fix the failing test" }] }]
    const opening = digest(request("openai-responses", { instructions: "You are Codex.", input }))
    const step = digest(
      request("openai-responses", {
        instructions: "You are Codex.",
        input: [
          ...input,
          { type: "function_call", call_id: "c1", name: "shell", arguments: "{}" },
          { type: "function_call_output", call_id: "c1", output: "1 failed" },
        ],
      }),
    )
    expect(opening).toMatchObject({ ask: "Fix the failing test", human: true })
    expect(step).toMatchObject({ human: false })
    expect(step.turn).toBe(opening.turn)
    expect(digest(request("openai-responses", { input: "Just a string" }))).toMatchObject({ ask: "Just a string", human: true })
  })

  test("OpenAI Chat and Google detect images and tool responses", () => {
    expect(
      digest(
        request("openai-chat", {
          messages: [{ role: "user", content: [{ type: "text", text: "What is this?" }, { type: "image_url", image_url: { url: "data:" } }] }],
        }),
      ),
    ).toMatchObject({ ask: "What is this?", images: true, human: true })
    expect(
      digest(
        request("google-generate", {
          contents: [
            { role: "user", parts: [{ text: "Weather?" }] },
            { role: "model", parts: [{ functionCall: { name: "weather", args: {} } }] },
            { role: "user", parts: [{ functionResponse: { name: "weather", response: { sky: "clear" } } }] },
          ],
        }),
      ),
    ).toMatchObject({ ask: "Weather?", human: false })
  })

  test("an unreadable body yields an empty digest instead of refusing the request", () => {
    expect(digest(request("anthropic-messages", "not an object"))).toMatchObject({ ask: "", human: false, turn: "" })
  })
})
