import { Effect } from "effect"
import { expect, test } from "vitest"
import { Bedrock } from "../src/scenario/bedrock.js"
import { TestApp } from "../src/application.js"
import { Chat } from "../src/scenario/chat.js"

test("an SDK-created service key discovers Models through the real native Gateway route", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const serviceAccount = yield* Effect.tryPromise(() =>
          app.client.serviceAccount.create({ name: "Gateway fixture" }),
        )
        const apiKey = yield* Effect.tryPromise(() =>
          app.client.serviceAccount.key.create({ id: serviceAccount.id, name: "Gateway key" }),
        )

        const discover = () =>
          Effect.tryPromise(() =>
            fetch(new URL("/inference/openai/v1/models", app.origin), {
              headers: { authorization: `Bearer ${apiKey.secret}` },
            }),
          )
        const response = yield* discover()
        expect(response.status).toBe(200)
        const body = yield* Effect.promise(() => response.json())
        expect(body).toMatchObject({
          object: "list",
          data: expect.arrayContaining([
            expect.objectContaining({
              id: `${data.session.model.provider}/${data.session.model.id}`,
              object: "model",
              owned_by: "bymorning",
            }),
          ]),
        })
        expect(yield* app.llm.list()).toEqual([])

        const workspace = data.owner.properties.workspaceID
        const config = yield* Effect.tryPromise(() => app.client["api.config"].get({ workspace }))
        yield* Effect.tryPromise(() =>
          app.client["api.config"].update({ workspace, ...config, gateway: { ...config.gateway, models: [] } }),
        )
        const restricted = yield* Effect.tryPromise(() =>
          fetch(new URL("/inference/openai/v1/chat/completions", app.origin), {
            method: "POST",
            headers: { authorization: `Bearer ${apiKey.secret}`, "content-type": "application/json" },
            body: JSON.stringify({ model: `${data.session.model.provider}/${data.session.model.id}`, messages: [] }),
          }),
        )
        expect(restricted.status).toBe(403)
        expect(yield* Effect.promise(() => restricted.json())).toMatchObject({
          error: { type: "permission_error" },
        })
      }),
    ),
    { signal },
  )
})

test("agent-sized inference bodies reach the upstream and oversized bodies get a 413 reply", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { app, upstream, headers } = yield* Bedrock.make()
        // Coding agents send system prompts and Tool schemas well past the 40 KiB default limit.
        const system = "x".repeat(200 * 1024)
        const forwarded = yield* upstream.expect({
          transport: "converse",
          response: "text",
          expect: (request) => {
            expect(JSON.stringify(request.body)).toContain(system)
          },
        })
        const large = yield* Effect.tryPromise(() =>
          fetch(new URL("/inference/openai/v1/chat/completions", app.origin), {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: Bedrock.model.converse,
              messages: [
                { role: "system", content: system },
                { role: "user", content: "hello" },
              ],
            }),
          }),
        )
        expect(large.status).toBe(200)
        yield* Effect.promise(() => large.text())
        yield* forwarded.settled
        expect(yield* upstream.count).toBe(1)

        // Beyond the inference limit the caller gets an answer, not a dropped connection.
        const oversized = yield* Effect.tryPromise(() =>
          fetch(new URL("/inference/openai/v1/chat/completions", app.origin), {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: Bedrock.model.converse,
              messages: [{ role: "user", content: "x".repeat(33 * 1024 * 1024) }],
            }),
          }),
        )
        expect(oversized.status).toBe(413)
        expect(yield* Effect.promise(() => oversized.json())).toMatchObject({
          error: { code: "request_too_large" },
        })
        expect(yield* upstream.count).toBe(1)
      }),
    ),
    { signal },
  )
})

test("a Service Account Spend Limit admits one completion and refuses with retry-after", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { app, upstream, owner } = yield* Bedrock.make()
        const workspace = owner.properties.workspaceID
        const serviceAccount = yield* Effect.tryPromise(() =>
          app.client.serviceAccount.create({ name: "Budget fixture" }),
        )
        const apiKey = yield* Effect.tryPromise(() =>
          app.client.serviceAccount.key.create({ id: serviceAccount.id, name: "Budget key" }),
        )
        // One paid completion must exhaust the tiny limit and refuse the next one.
        yield* Effect.tryPromise(() =>
          app.client.budget.limit({
            workspace,
            target: { type: "service_account", serviceAccountID: serviceAccount.id },
            amount: 0.000001,
          }),
        )
        // Script exactly one upstream completion; the refusal must not reach the model.
        const paid = yield* upstream.expect({
          transport: "converse",
          response: "text",
          expect: () => {},
        })

        const completion = yield* Effect.tryPromise(() =>
          fetch(new URL("/inference/openai/v1/chat/completions", app.origin), {
            method: "POST",
            headers: { authorization: `Bearer ${apiKey.secret}`, "content-type": "application/json" },
            body: JSON.stringify({ model: Bedrock.model.converse, messages: [{ role: "user", content: "hello" }] }),
          }),
        )
        expect(completion.status).toBe(200)
        expect(yield* upstream.count).toBe(1)
        yield* paid.settled

        const status = yield* Effect.tryPromise(() => app.client.budget.status({ workspace }))
        const accountStanding = status.standings.find(
          ({ target }) => target.type === "service_account" && target.serviceAccountID === serviceAccount.id,
        )
        expect(accountStanding).toMatchObject({ limit: 0.000001 })
        expect(accountStanding?.spent ?? 0).toBeGreaterThan(0)
        const workspaceStanding = status.standings.find(({ target }) => target.type === "workspace")
        expect(workspaceStanding).toMatchObject({ spent: expect.any(Number), period: status.period })
        expect("limit" in (workspaceStanding ?? {})).toBe(false)
        expect(workspaceStanding?.spent ?? 0).toBeGreaterThan(0)

        const refused = yield* Effect.tryPromise(() =>
          fetch(new URL("/inference/openai/v1/chat/completions", app.origin), {
            method: "POST",
            headers: { authorization: `Bearer ${apiKey.secret}`, "content-type": "application/json" },
            body: JSON.stringify({ model: Bedrock.model.converse, messages: [{ role: "user", content: "hello again" }] }),
          }),
        )
        expect(refused.status).toBe(429)
        expect(refused.headers.get("retry-after")).toBeTruthy()
        expect(yield* Effect.promise(() => refused.json())).toMatchObject({
          error: { type: "rate_limit_error" },
        })

        // Discovery is not budget-gated.
        const discovery = yield* Effect.tryPromise(() =>
          fetch(new URL("/inference/openai/v1/models", app.origin), {
            headers: { authorization: `Bearer ${apiKey.secret}` },
          }),
        )
        expect(discovery.status).toBe(200)
      }),
    ),
    { signal },
  )
})
