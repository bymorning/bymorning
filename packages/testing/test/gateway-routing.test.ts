import { Effect } from "effect"
import { expect, test } from "vitest"
import { Provider } from "@bymorning/schema/provider"
import { Bedrock } from "../src/scenario/bedrock.js"

const auto = { provider: Provider.Name.make("auto"), id: "bedrock" }
const cheap = { provider: Provider.AmazonBedrock, id: Bedrock.model.converse }
const large = { provider: Provider.AmazonBedrock, id: Bedrock.model.mantle }

const rule = {
  match: { model: auto },
  to: {
    tiers: [
      { name: "cheap", model: cheap, description: "Short questions" },
      { name: "large", model: large, description: "Hard multi-step work" },
    ],
    default: "cheap",
    judge: { model: cheap, timeout: 10_000 },
  },
}

test("LLM Gateway judges once per participant ask and pins that Tier for its Tool steps", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { app, upstream, headers } = yield* Bedrock.make()
        const config = yield* Effect.tryPromise(() => app.client["api.config"].get())
        yield* Effect.tryPromise(() => app.client["api.config"].update({ ...config, routing: [rule] as typeof config.routing }))

        // Claude Code discovers Auto names through the Anthropic Models list.
        const anthropic = yield* Effect.promise(() =>
          fetch(new URL("/inference/anthropic/v1/models", app.origin), { headers }),
        )
        expect(anthropic.status).toBe(200)
        expect(yield* Effect.promise(() => anthropic.json())).toMatchObject({
          data: expect.arrayContaining([expect.objectContaining({ type: "model", id: "auto/bedrock" })]),
        })

        const ask = [{ role: "user", content: "What's the weather in Paris?" }]
        // The fixture judge answers "Hello 世界", which names no Tier: the default Tier serves the ask.
        const judged = yield* upstream.expect({
          transport: "converse",
          response: "text",
          expect: (request) => expect(JSON.stringify(request.body)).toContain("Classify this request"),
        })
        const served = yield* upstream.expect({
          transport: "converse",
          response: "text",
          expect: (request) => expect(JSON.stringify(request.body)).not.toContain("Classify this request"),
        })
        const first = yield* Effect.promise(() =>
          fetch(new URL("/inference/openai/v1/chat/completions", app.origin), {
            method: "POST",
            headers,
            body: JSON.stringify({ model: "auto/bedrock", messages: ask }),
          }),
        )
        expect(first.status, yield* Effect.promise(() => first.clone().text())).toBe(200)
        expect(first.headers.get("x-bymorning-route-cause")).toBe("fallback")
        expect(first.headers.get("x-bymorning-route-tier")).toBe("cheap")
        // The fixture judge's reply names no Tier, so the fallback reason is observable.
        expect(first.headers.get("x-bymorning-route-fallback")).toBe("invalid")
        yield* judged.settled
        yield* served.settled

        // A Tool step of the same ask reuses the pinned Tier without a judge inference.
        const step = yield* upstream.expect({ transport: "converse", response: "text", expect: () => {} })
        const second = yield* Effect.promise(() =>
          fetch(new URL("/inference/openai/v1/chat/completions", app.origin), {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: "auto/bedrock",
              messages: [
                ...ask,
                {
                  role: "assistant",
                  content: null,
                  tool_calls: [{ id: "call_1", type: "function", function: { name: "weather", arguments: '{"city":"Paris"}' } }],
                },
                { role: "tool", tool_call_id: "call_1", content: "sunny" },
              ],
            }),
          }),
        )
        expect(second.status, yield* Effect.promise(() => second.clone().text())).toBe(200)
        expect(second.headers.get("x-bymorning-route-cause")).toBe("pinned")
        expect(second.headers.get("x-bymorning-route-tier")).toBe("cheap")
        expect(second.headers.get("x-bymorning-route-fallback")).toBeNull()
        yield* step.settled
        expect(yield* upstream.count).toBe(3)
        yield* upstream.verify

        // The judge is its own recorded inference beside the two it routed.
        const usage = yield* Effect.tryPromise(() => app.client.usage.records())
        expect(usage.data.filter((record) => record.source === "inference")).toHaveLength(3)
      }),
    ),
    { signal },
  )
})

test("an Auto name no Tier of which the caller format can reach is not listed", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { app, headers } = yield* Bedrock.make()
        const config = yield* Effect.tryPromise(() => app.client["api.config"].get())
        const unreachable = { provider: Provider.OpenAI, id: "gpt-5.6" }
        yield* Effect.tryPromise(() =>
          app.client["api.config"].update({
            ...config,
            routing: [{ match: { model: { ...auto, id: "openai" } }, to: unreachable }] as typeof config.routing,
          }),
        )
        const listed = yield* Effect.promise(() =>
          fetch(new URL("/inference/anthropic/v1/models", app.origin), { headers }).then((response) => response.json()),
        )
        expect(JSON.stringify(listed)).not.toContain("auto/openai")
      }),
    ),
    { signal },
  )
})
