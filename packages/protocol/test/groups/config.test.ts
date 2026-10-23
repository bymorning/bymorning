import { Schema } from "effect"
import { HttpApi } from "effect/unstable/httpapi"
import { describe, expect, test } from "vitest"
import { Api } from "../../src/api.js"

describe("Workspace Config protocol", () => {
  test("declares its endpoints", () => {
    const endpoints: Array<{ identifier: string; method: string; path: string }> = []
    let updatePayload: Schema.Top | undefined
    HttpApi.reflect(Api, {
      onGroup() {},
      onEndpoint({ endpoint, group }) {
        if (group.identifier !== "api.config") return
        endpoints.push({ identifier: endpoint.identifier, method: endpoint.method, path: endpoint.path })
        if (endpoint.identifier === "config.update") {
          updatePayload = Array.from(endpoint.payload.values())[0]?.schemas[0]
        }
      },
    })
    expect(endpoints).toEqual([
      { identifier: "config.get", method: "GET", path: "/api/config" },
      { identifier: "config.update", method: "PUT", path: "/api/config" },
      { identifier: "config.refresh", method: "POST", path: "/api/config/refresh" },
    ])
    if (updatePayload === undefined) throw new Error("Missing Config update payload")
    const decodePayload = Schema.decodeUnknownSync(Schema.make<Schema.Codec<unknown, unknown>>(updatePayload.ast))
    expect(
      decodePayload({
        plugins: ["/workspace/plugin.ts", { package: "@example/plugin", options: { enabled: true } }],
      }),
    ).toEqual({
      plugins: ["/workspace/plugin.ts", { package: "@example/plugin", options: { enabled: true } }],
    })
    expect(decodePayload({ tool_output: {} })).toEqual({ tool_output: {} })
    expect(decodePayload({ tool_output: { max_lines: 12, max_bytes: 4_096 } })).toEqual({
      tool_output: { max_lines: 12, max_bytes: 4_096 },
    })
    expect(
      decodePayload({
        providers: { allow: ["openai"] },
        routing: [
          { to: { provider: "anthropic", id: "opus" }, from: { provider: "openai", id: "gpt" } },
          { to: { provider: "openai", id: "o3" }, when: { tool: "bash" } },
          {
            to: { provider: "anthropic", id: "sonnet", variant: "thinking" },
            from: { provider: "openai", id: "gpt" },
            when: { tool: "edit" },
          },
        ],
      }),
    ).toEqual({
      providers: { allow: ["openai"] },
      routing: [
        { to: { provider: "anthropic", id: "opus" }, from: { provider: "openai", id: "gpt" } },
        { to: { provider: "openai", id: "o3" }, when: { tool: "bash" } },
        {
          to: { provider: "anthropic", id: "sonnet", variant: "thinking" },
          from: { provider: "openai", id: "gpt" },
          when: { tool: "edit" },
        },
      ],
    })
    expect(() => decodePayload({ plugins: [{ options: {} }] })).toThrow()
    expect(() => decodePayload({ tool_output: { max_lines: 0 } })).toThrow()
    expect(() => decodePayload({ tool_output: { max_lines: 1 } })).toThrow()
    expect(() => decodePayload({ tool_output: { max_bytes: 1.5 } })).toThrow()
    expect(() => decodePayload({ tool_output: { max_bytes: 3 } })).toThrow()
    expect(decodePayload({ default_model: { provider: "openai", id: "gpt" }, model_policy: {} })).toEqual({})
  })
})
