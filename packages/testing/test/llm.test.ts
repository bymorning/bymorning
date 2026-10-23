import { Model } from "@bymorning/core/model"
import { Provider } from "@bymorning/core/provider"
import { Agent } from "@bymorning/schema/agent"
import { Model as ModelSchema } from "@bymorning/schema/model"
import { Provider as ProviderSchema } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import { configure } from "@opencode-ai/ai/providers/openai-compatible"
import { Auth } from "@opencode-ai/ai/route/auth"
import { Message } from "@opencode-ai/ai/schema/messages"
import { Effect, Fiber, Layer, Stream } from "effect"
import { expect, test } from "vitest"
import { TestLLM } from "../src/llm.js"

const first = Session.ID.make("00000000-0000-4000-8000-000000000001")
const second = Session.ID.make("00000000-0000-4000-8000-000000000002")
const model = ModelSchema.Ref.make({ provider: ProviderSchema.OpenCode, id: "deepseek-v4-pro" })
const live = Layer.merge(Provider.layer, Model.layer)

const stream = (llm: TestLLM.Interface, sessionID = first, purpose: TestLLM.Purpose = "assistant") =>
  Stream.unwrap(
    Effect.gen(function* () {
      const models = yield* Model.Service
      const providers = yield* Provider.Service
      const selection = yield* models.get(model)
      return providers.stream({
        context: { purpose, sessionID, agent: Agent.ID.make("build"), requestedModel: model, model },
        selection,
        runtimeModel: configure({
          provider: "bymorning",
          baseURL: llm.url,
          auth: Auth.none,
          headers: { "x-bm-test-session": sessionID, "x-bm-test-purpose": purpose },
        }).model(selection.info.apiID),
        authentication: (request, handler) => handler(request),
        http: (request, handler) => handler(request),
        messages: [Message.user("Read notes.txt")],
        tools: [
          {
            name: "read",
            description: "Read a file",
            inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
          },
        ],
      })
    }),
  )

const request = (llm: TestLLM.Interface, sessionID = first, purpose: TestLLM.Purpose = "assistant", streaming = true) =>
  Effect.tryPromise(() =>
    fetch(`${llm.url}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bm-test-session": sessionID, "x-bm-test-purpose": purpose },
      body: JSON.stringify({
        model: "fixture",
        messages: [{ role: "user", content: "Read notes.txt" }],
        stream: streaming,
      }),
    }),
  )

test("real Provider parses text, reasoning, tool arguments and usage from the scripted wire", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const llm = yield* TestLLM.make()
        yield* llm.expect(first, "assistant", [
          {
            expect: (request) => {
              expect(request).toMatchObject({ sessionID: first, purpose: "assistant", stream: true })
              expect(request.messages).toContainEqual({ role: "user", content: "Read notes.txt" })
              expect(request.tools?.map((tool) => tool.function.name)).toContain("read")
            },
            response: {
              type: "success",
              events: [
                { reasoning: "Inspect the file." },
                { text: "I will read it." },
                { tool: { id: "read-1", name: "read", input: { path: "notes.txt" } } },
              ],
              usage: { input: 21, output: 8 },
            },
          },
        ])
        const events = yield* stream(llm).pipe(Stream.runCollect, Effect.provide(live))
        expect(events).toContainEqual(expect.objectContaining({ type: "text-delta", text: "I will read it." }))
        expect(events).toContainEqual(expect.objectContaining({ type: "reasoning-delta", text: "Inspect the file." }))
        expect(events).toContainEqual(
          expect.objectContaining({ type: "tool-call", id: "read-1", name: "read", input: { path: "notes.txt" } }),
        )
        expect(events).toContainEqual(
          expect.objectContaining({
            type: "finish",
            usage: expect.objectContaining({ inputTokens: 21, outputTokens: 8 }),
          }),
        )
        yield* llm.verify()
      }),
    ),
    { signal },
  )
})

test("independent Session and purpose scripts cannot consume each other's responses", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const llm = yield* TestLLM.make()
        yield* llm.expect(first, "assistant", [
          {
            expect: (request) => expect(request.purpose).toBe("assistant"),
            response: { type: "success", events: [{ text: "before" }, { gate: "assistant" }, { text: "after" }] },
          },
        ])
        yield* llm.expect(first, "title", [
          {
            expect: (request) => expect(request.purpose).toBe("title"),
            response: { type: "success", events: [{ text: "title" }] },
          },
        ])
        yield* llm.expect(second, "assistant", [
          {
            expect: (request) => expect(request.sessionID).toBe(second),
            response: { type: "success", events: [{ text: "second" }] },
          },
        ])
        const blocked = yield* request(llm).pipe(
          Effect.flatMap((response) => Effect.tryPromise(() => response.text())),
          Effect.forkScoped,
        )
        yield* llm.waitGate("assistant")
        const title = yield* request(llm, first, "title", false).pipe(
          Effect.flatMap((response) => Effect.tryPromise(() => response.json())),
        )
        expect(title).toMatchObject({ choices: [{ message: { content: "title" } }] })
        const other = yield* request(llm, second).pipe(
          Effect.flatMap((response) => Effect.tryPromise(() => response.text())),
        )
        expect(other).toContain("second")
        yield* llm.release("assistant")
        expect(yield* Fiber.join(blocked)).toContain("after")
        expect((yield* llm.list()).map((request) => [request.sessionID, request.purpose])).toEqual([
          [first, "assistant"],
          [first, "title"],
          [second, "assistant"],
        ])
        yield* llm.verify()
      }),
    ),
    { signal },
  )
})

test("real Provider classifies scripted HTTP authentication errors", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const llm = yield* TestLLM.make()
        yield* llm.expect(first, "assistant", [
          {
            expect: (request) => expect(request.model).toBe("deepseek-v4-pro"),
            response: { type: "error", status: 401, message: "Fixture key refused" },
          },
        ])
        const error = yield* stream(llm).pipe(Stream.runDrain, Effect.provide(live), Effect.flip)
        expect(error).toMatchObject({
          _tag: "Provider.FailureError",
          status: 401,
          category: "auth",
          message: "Fixture key refused",
        })
        yield* llm.verify()
      }),
    ),
    { signal },
  )
})

test("a named gate observes actual Provider cancellation without sleeps", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const llm = yield* TestLLM.make()
        yield* llm.expect(first, "assistant", [
          {
            expect: (request) => expect(request.stream).toBe(true),
            response: { type: "cancel", gate: "cancel", text: ["partial"] },
          },
        ])
        const fiber = yield* stream(llm).pipe(Stream.runDrain, Effect.provide(live), Effect.forkScoped)
        yield* llm.waitGate("cancel")
        expect(yield* llm.wait(first, "assistant")).toMatchObject({ sessionID: first })
        const active = yield* llm.verify().pipe(Effect.flip)
        expect(active.message).toContain("active")
        yield* Fiber.interrupt(fiber)
        yield* llm.settled(first, "assistant")
        yield* llm.verify()
      }),
    ),
    { signal },
  )
})

test("scope finalization rejects unused model expectations", async ({ signal }) => {
  await expect(
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const llm = yield* TestLLM.make()
          yield* llm.expect(first, "assistant", [
            { expect: () => undefined, response: { type: "success", events: [{ text: "unused" }] } },
          ])
        }),
      ),
      { signal },
    ),
  ).rejects.toThrow("Unconsumed model step")
})

test("assertion failures survive an application swallowing the model's HTTP error", async ({ signal }) => {
  await expect(
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const llm = yield* TestLLM.make()
          yield* llm.expect(first, "assistant", [
            {
              expect: (request) => expect(request.messages).toEqual([]),
              response: { type: "success", events: [{ gate: "never-reached" }] },
            },
          ])
          const response = yield* request(llm)
          expect(response.status).toBe(500)
          yield* Effect.tryPromise(() => response.text())
          const failed = yield* llm.waitGate("never-reached").pipe(Effect.flip)
          expect(failed.message).toContain("Model request assertion failed")
        }),
      ),
      { signal },
    ),
  ).rejects.toThrow("Model request assertion failed")
})

test("missing correlation headers fail the fixture even when callers ignore the HTTP error", async ({ signal }) => {
  await expect(
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const llm = yield* TestLLM.make()
          const response = yield* Effect.tryPromise(() =>
            fetch(`${llm.url}/chat/completions`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ model: "fixture", messages: [] }),
            }),
          )
          expect(response.status).toBe(500)
          yield* Effect.tryPromise(() => response.text())
        }),
      ),
      { signal },
    ),
  ).rejects.toThrow("Missing or invalid model correlation headers")
})

test("requests beyond the required script fail fixture finalization", async ({ signal }) => {
  await expect(
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const llm = yield* TestLLM.make()
          const response = yield* request(llm)
          expect(response.status).toBe(500)
          yield* Effect.tryPromise(() => response.text())
        }),
      ),
      { signal },
    ),
  ).rejects.toThrow("Unexpected model request")
})

test("malformed wire data reaches the real Provider decoder", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const llm = yield* TestLLM.make()
        yield* llm.expect(first, "assistant", [
          {
            expect: (request) => expect(request.stream).toBe(true),
            response: { type: "malformed", data: 'data: {"choices":[{"delta":{"content":123}}]}\n\n' },
          },
        ])
        const error = yield* stream(llm).pipe(Stream.runDrain, Effect.provide(live), Effect.flip)
        expect(error).toMatchObject({ _tag: "Provider.FailureError" })
        yield* llm.verify()
      }),
    ),
    { signal },
  )
})

test("a truncated stream preserves partial text without inventing the model's finish reason", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const llm = yield* TestLLM.make()
        yield* llm.expect(first, "assistant", [
          {
            expect: (request) => expect(request.stream).toBe(true),
            response: { type: "truncated", text: ["partial ", "answer"] },
          },
        ])
        const events = yield* stream(llm).pipe(Stream.runCollect, Effect.provide(live))
        expect(events.filter((event) => event.type === "text-delta").map((event) => event.text)).toEqual([
          "partial ",
          "answer",
        ])
        expect(events).toContainEqual(expect.objectContaining({ type: "finish", reason: { normalized: "unknown" } }))
        yield* llm.verify()
      }),
    ),
    { signal },
  )
})
