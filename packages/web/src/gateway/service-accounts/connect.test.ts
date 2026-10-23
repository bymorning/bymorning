import { describe, expect, it } from "vitest"

import { available, clients, type ActiveModel } from "./connect"

const origin = "http://gw.test"
const key = "bm_secret"
const by = (id: string, models: ReadonlyArray<ActiveModel> = []) =>
  clients.find((client) => client.id === id)!.config({ origin, key, models })

describe("client connect configuration", () => {
  it("offers every client when availability is unknown, and only matching formats once known", () => {
    expect(available(undefined)).toEqual(clients)
    expect(available(new Set(["anthropic"])).map((client) => client.id)).toEqual(["claude-code", "curl"])
    expect(available(new Set(["oa-compat"])).map((client) => client.id)).toEqual([
      "cursor",
      "copilot",
      "opencode",
      "openai",
      "curl",
    ])
    expect(available(new Set(["openai", "google"])).map((client) => client.id)).toEqual(["codex", "gemini", "curl"])
    // Bedrock is translated from any caller format, so it satisfies every client.
    expect(available(new Set(["bedrock-converse"])).map((client) => client.id)).toEqual(clients.map((c) => c.id))
    expect(available(new Set()).map((client) => client.id)).toEqual(["curl"])
  })

  it("points each client at the ingress for its format with the real key", () => {
    expect(by("claude-code")).toBe(
      'export ANTHROPIC_BASE_URL="http://gw.test/inference/anthropic"\nexport ANTHROPIC_AUTH_TOKEN="bm_secret"',
    )
    expect(by("codex")).toContain('base_url = "http://gw.test/inference/openai/v1"')
    expect(by("codex")).toContain('export BYMORNING_API_KEY="bm_secret"')
    expect(by("cursor")).toContain("Override OpenAI Base URL: on, http://gw.test/inference/openai/v1")
    expect(by("copilot")).toContain('"url": "http://gw.test/inference/openai/v1/chat/completions"')
    expect(by("opencode")).toContain('"baseURL": "http://gw.test/inference/openai/v1"')
    expect(by("gemini")).toContain('GOOGLE_GEMINI_BASE_URL="http://gw.test/inference/google"')
    expect(by("openai")).toContain('OPENAI_BASE_URL="http://gw.test/inference/openai/v1"')
  })

  it("names a model the client can actually call, never one from another format", () => {
    const models: ReadonlyArray<ActiveModel> = [
      { id: "anthropic/claude-sonnet-4", format: "anthropic" },
      { id: "openai/gpt-5", format: "openai" },
      { id: "groq/llama", format: "oa-compat" },
    ]
    expect(by("codex", models)).toContain('model = "openai/gpt-5"')
    expect(by("cursor", models)).toContain("Add Model: groq/llama")
    expect(by("opencode", models)).toContain('"groq/llama": {}')
    expect(by("cursor")).toContain("Add Model: provider/model")
  })

  it("writes the raw request in the first model's own format", () => {
    const anthropic = by("curl", [{ id: "anthropic/claude-sonnet-4", format: "anthropic" }])
    expect(anthropic).toContain("/inference/anthropic/v1/messages")
    expect(anthropic).toContain("x-api-key: bm_secret")
    expect(anthropic).toContain("anthropic-version")
    expect(anthropic).not.toContain("chat/completions")

    expect(by("curl", [{ id: "openai/gpt-5", format: "openai" }])).toContain("/v1/responses")
    expect(by("curl", [{ id: "groq/llama", format: "oa-compat" }])).toContain("/v1/chat/completions")
    expect(by("curl", [{ id: "google/gemini-2.5-pro", format: "google" }])).toContain(
      "models/google%2Fgemini-2.5-pro:generateContent",
    )
    expect(by("curl")).toContain('"model":"provider/model"')
  })
})
