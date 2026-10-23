import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { AuthenticationError, DeniedError, InputError, NotFoundError } from "../../src/llm-gateway/failure.js"
import { adapters } from "../../src/llm-gateway/protocol.js"

const openAIUsage = { input: 80, output: 23, reasoning: 7, cacheRead: 20, cacheWrite: 0 }
const entries = [
  { id: "alpha", name: "Alpha" },
  { id: "beta", name: "Beta" },
]
const post = (url: string, body: unknown) =>
  HttpServerRequest.fromWeb(
    new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  )

describe("LLM Gateway ingress adapters", () => {
  it.effect("parses body-addressed requests and rejects missing models", () =>
    Effect.gen(function* () {
      const parsed = yield* adapters["openai-responses"].parse(
        post("https://gateway.example/inference/openai/v1/responses", { model: "public", stream: true, input: "hi" }),
      )
      expect(parsed).toEqual({
        protocol: "openai-responses",
        model: "public",
        stream: true,
        body: { model: "public", stream: true, input: "hi" },
      })
      const missing = yield* adapters["anthropic-messages"]
        .parse(post("https://gateway.example/inference/anthropic/v1/messages", { messages: [] }))
        .pipe(Effect.flip)
      expect(missing).toEqual(new InputError({ reason: "model required" }))
      const invalid = yield* adapters["openai-chat"]
        .parse(HttpServerRequest.fromWeb(new Request("https://gateway.example/x", { method: "POST", body: "nope" })))
        .pipe(Effect.flip)
      expect(invalid.reason).toBe("Invalid JSON body")
    }),
  )

  it.effect("parses Google actions from the encoded path", () =>
    Effect.gen(function* () {
      const parsed = yield* adapters["google-generate"].parse(
        post("https://gateway.example/inference/google/v1beta/models/public%20model:generateContent", { contents: [] }),
      )
      expect(parsed).toEqual({
        protocol: "google-generate",
        model: "public model",
        stream: false,
        action: "generateContent",
        body: { contents: [] },
      })
      const malformed = yield* adapters["google-generate"]
        .parse(post("https://gateway.example/inference/google/v1beta/models/public:unknown", {}))
        .pipe(Effect.flip)
      expect(malformed).toEqual(new InputError({ reason: "Invalid Google model action" }))
    }),
  )

  it("renders discovery envelopes natively", () => {
    const now = Date.UTC(2026, 8, 8)
    expect(adapters["openai-chat"].models(entries, now)).toEqual({
      object: "list",
      data: [
        { id: "alpha", object: "model", created: now / 1000, owned_by: "bymorning" },
        { id: "beta", object: "model", created: now / 1000, owned_by: "bymorning" },
      ],
    })
    expect(adapters["anthropic-messages"].models(entries, now)).toMatchObject({
      data: [
        { type: "model", id: "alpha", display_name: "Alpha" },
        { type: "model", id: "beta" },
      ],
      has_more: false,
      first_id: "alpha",
      last_id: "beta",
    })
    expect(adapters["google-generate"].models(entries, now)).toEqual({
      models: [
        { name: "models/alpha", displayName: "Alpha" },
        { name: "models/beta", displayName: "Beta" },
      ],
    })
  })

  it("renders typed failures in each native error envelope", () => {
    expect(adapters["openai-chat"].error(new AuthenticationError())).toEqual({
      status: 401,
      headers: { "content-type": "application/json", "www-authenticate": "Bearer" },
      body: { error: { message: "Authentication required", type: "authentication_error", code: null } },
    })
    expect(adapters["openai-responses"].error(new NotFoundError({ model: "x" }))).toMatchObject({
      status: 404,
      body: { error: { type: "invalid_request_error", code: "model_not_found" } },
    })
    expect(adapters["anthropic-messages"].error(new DeniedError({ reason: "rate" }))).toMatchObject({
      status: 429,
      body: { type: "error", error: { type: "rate_limit_error", message: "Request denied" } },
    })
    expect(adapters["google-generate"].error(new DeniedError({ reason: "model" }))).toMatchObject({
      status: 403,
      body: { error: { code: 403, status: "PERMISSION_DENIED" } },
    })
  })
})

describe("LLM Gateway protocol adapters", () => {
  it("rewrites OpenAI Chat and extracts usage", () => {
    const adapter = adapters["openai-chat"]
    expect(adapter.rewrite({ model: "public", messages: [], extension: 1 }, "upstream", true)).toEqual({
      model: "upstream",
      messages: [],
      extension: 1,
      stream_options: { include_usage: true },
    })
    expect(adapter.url("https://api.example/v1", "ignored", true)).toBe("https://api.example/v1/chat/completions")
    const response = {
      usage: {
        prompt_tokens: 100,
        completion_tokens: 30,
        prompt_tokens_details: { cached_tokens: 20 },
        completion_tokens_details: { reasoning_tokens: 7 },
      },
    }
    expect(adapter.usage(response)).toEqual(openAIUsage)
    const parser = adapter.parser()
    parser.parse({ event: "message", data: "not-json" })
    parser.parse({ event: "message", data: JSON.stringify({ usage: null }) })
    expect(parser.retrieve()).toBeUndefined()
    parser.parse({ event: "message", data: JSON.stringify(response) })
    expect(parser.retrieve()).toEqual(openAIUsage)
  })

  it("rewrites OpenAI Responses and reads completed-event usage", () => {
    const adapter = adapters["openai-responses"]
    expect(adapter.rewrite({ model: "public", input: "hello" }, "upstream", true)).toEqual({
      model: "upstream",
      input: "hello",
    })
    const usage = {
      input_tokens: 100,
      output_tokens: 30,
      input_tokens_details: { cached_tokens: 20 },
      output_tokens_details: { reasoning_tokens: 7 },
    }
    const parser = adapter.parser()
    parser.parse({ event: "response.in_progress", data: JSON.stringify({ response: { usage } }) })
    expect(parser.retrieve()).toBeUndefined()
    parser.parse({ event: "response.completed", data: JSON.stringify({ response: { usage } }) })
    expect(parser.retrieve()).toEqual(openAIUsage)
  })

  it("merges Anthropic stream usage", () => {
    const adapter = adapters["anthropic-messages"]
    const parser = adapter.parser()
    parser.parse({
      event: "message_start",
      data: '{"message":{"usage":{"input_tokens":10,"cache_read_input_tokens":3,"cache_creation":{"ephemeral_5m_input_tokens":2}}}}',
    })
    parser.parse({
      event: "message_delta",
      data: '{"usage":{"output_tokens":4,"cache_creation":{"ephemeral_1h_input_tokens":1}}}',
    })
    expect(parser.retrieve()).toEqual({ input: 10, output: 4, reasoning: 0, cacheRead: 3, cacheWrite: 3 })
  })

  it("keeps Google bodies native and extracts usage", () => {
    const adapter = adapters["google-generate"]
    const body = { contents: [], extension: { enabled: true } }
    expect(adapter.rewrite(body, "gemini-upstream", true)).toBe(body)
    expect(adapter.url("https://api.example/v1beta", "gemini-upstream", true)).toBe(
      "https://api.example/v1beta/models/gemini-upstream:streamGenerateContent?alt=sse",
    )
    const response = {
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 20,
        cachedContentTokenCount: 40,
        thoughtsTokenCount: 5,
      },
    }
    expect(adapter.usage(response)).toEqual({ input: 60, output: 20, reasoning: 5, cacheRead: 40, cacheWrite: 0 })
  })
})
