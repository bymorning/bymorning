import { AwsRegion } from "@bymorning/schema/aws-region"
import { Effect } from "effect"
import { expect, test } from "vitest"
import { Bedrock } from "../src/scenario/bedrock.js"
import type { TestBedrock } from "../src/bedrock.js"

const protocols = ["chat", "responses", "anthropic", "google"] as const
type Protocol = (typeof protocols)[number]
const publicID = (transport: "converse" | "mantle") => Bedrock.model[transport]
const path = (protocol: Protocol, model: string, stream: boolean) =>
  ({
    chat: "/inference/openai/v1/chat/completions",
    responses: "/inference/openai/v1/responses",
    anthropic: "/inference/anthropic/v1/messages",
    google: `/inference/google/v1beta/models/${encodeURIComponent(model)}:${stream ? "streamGenerateContent" : "generateContent"}`,
  })[protocol]
const schema = { type: "object", properties: { city: { type: "string" } }, required: ["city"] }
const body = (protocol: Protocol, model: string, stream: boolean) =>
  ({
    chat: {
      model,
      stream,
      messages: [
        { role: "system", content: "Be concise" },
        { role: "user", content: "Weather?" },
      ],
      max_tokens: 100,
      temperature: 0.3,
      tools: [{ type: "function", function: { name: "weather", description: "Get weather", parameters: schema } }],
    },
    responses: {
      model,
      stream,
      input: [{ role: "user", content: "Weather?" }],
      instructions: "Be concise",
      max_output_tokens: 100,
      temperature: 0.3,
      store: false,
      tools: [{ type: "function", name: "weather", description: "Get weather", parameters: schema }],
    },
    anthropic: {
      model,
      stream,
      messages: [{ role: "user", content: "Weather?" }],
      system: "Be concise",
      max_tokens: 100,
      temperature: 0.3,
      tools: [{ name: "weather", description: "Get weather", input_schema: schema }],
    },
    google: {
      contents: [{ role: "user", parts: [{ text: "Weather?" }] }],
      systemInstruction: { parts: [{ text: "Be concise" }] },
      generationConfig: { maxOutputTokens: 100, temperature: 0.3 },
      tools: [
        {
          functionDeclarations: [
            {
              name: "weather",
              description: "Get weather",
              parameters: { type: "OBJECT", properties: { city: { type: "STRING" } }, required: ["city"] },
            },
          ],
        },
      ],
    },
  })[protocol]
const outgoing =
  (transport: "converse" | "mantle", followup = false): TestBedrock.Step["expect"] =>
  (request) => {
    expect(request.url).toBe(
      transport === "converse"
        ? `https://bedrock-runtime.eu-west-1.amazonaws.com/model/${encodeURIComponent(Bedrock.model.converse)}/converse-stream`
        : "https://bedrock-mantle.eu-west-1.api.aws/v1/responses",
    )
    expect(request.headers.authorization).toContain(`Credential=fixture-workspace/`)
    expect(request.headers.authorization).toContain(
      `/eu-west-1/${transport === "converse" ? "bedrock" : "bedrock-mantle"}/aws4_request`,
    )
    expect(request.headers["x-amz-security-token"]).toBe("fixture-token")
    if (followup) {
      expect(JSON.stringify(request.body)).toContain("call_weather")
      expect(JSON.stringify(request.body)).toContain("sunny")
    } else if (transport === "converse")
      expect(request.body).toMatchObject({
        messages: [{ role: "user", content: [{ text: "Weather?" }] }],
        system: [{ text: "Be concise" }],
        inferenceConfig: { maxTokens: 100, temperature: 0.3 },
        toolConfig: { tools: [{ toolSpec: { name: "weather", inputSchema: { json: schema } } }] },
      })
    else
      expect(request.body).toMatchObject({
        model: Bedrock.model.mantle,
        stream: true,
        store: false,
        max_output_tokens: 100,
        temperature: 0.3,
        tools: [{ type: "function", name: "weather", parameters: schema }],
      })
  }

for (const transport of ["converse", "mantle"] as const)
  test(`${transport}: four caller formats preserve text, tools, streaming, credentials, and accounting`, async ({
    signal,
  }) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { app, upstream, headers, deployment } = yield* Bedrock.make()
        // Bundled AWS support and a default region do not activate Bedrock; the
        // deployment credential chain appears only once the Provider is enabled.
        expect(deployment?.connections ?? []).not.toContainEqual(
          expect.objectContaining({ type: "regional-deployment" }),
        )
        const id = publicID(transport)
        const discovery = yield* Effect.promise(() =>
          fetch(new URL("/inference/openai/v1/models", app.origin), { headers }),
        )
        expect(awaitJSON(yield* Effect.promise(() => discovery.text()))).toMatchObject({
          data: expect.arrayContaining([expect.objectContaining({ id })]),
        })
        let count = 0
        for (const protocol of protocols)
          for (const stream of [false, true])
            for (const kind of ["text", "tool"] as const) {
              const step = yield* upstream.expect({ transport, response: kind, expect: outgoing(transport) })
              const response = yield* Effect.promise(() =>
                fetch(new URL(path(protocol, id, stream), app.origin), {
                  method: "POST",
                  headers,
                  body: JSON.stringify(body(protocol, id, stream)),
                }),
              )
              const text = yield* Effect.promise(() => response.text())
              expect(response.status, text).toBe(200)
              expect(text).not.toContain("fixture-secret")
              expect(text).toContain(kind === "text" ? "Hello 世界" : "weather")
              if (kind === "tool") expect(text).toContain("Paris")
              if (stream) {
                expect(response.headers.get("content-type")).toContain("text/event-stream")
                expect(text).toContain(
                  protocol === "chat"
                    ? "[DONE]"
                    : protocol === "responses"
                      ? "response.completed"
                      : protocol === "anthropic"
                        ? "message_stop"
                        : "finishReason",
                )
              }
              yield* step.settled
              count++
              if (!stream && kind === "tool") {
                const reply = awaitJSON(text)
                const next = body(protocol, id, false)
                const followup =
                  protocol === "chat"
                    ? {
                        ...next,
                        messages: [
                          { role: "user", content: "Weather?" },
                          reply.choices[0].message,
                          { role: "tool", tool_call_id: reply.choices[0].message.tool_calls[0].id, content: "sunny" },
                        ],
                      }
                    : protocol === "responses"
                      ? {
                          ...next,
                          input: [
                            { role: "user", content: "Weather?" },
                            ...reply.output,
                            { type: "function_call_output", call_id: reply.output[0].call_id, output: "sunny" },
                          ],
                        }
                      : protocol === "anthropic"
                        ? {
                            ...next,
                            messages: [
                              { role: "user", content: "Weather?" },
                              { role: "assistant", content: reply.content },
                              {
                                role: "user",
                                content: [{ type: "tool_result", tool_use_id: reply.content[0].id, content: "sunny" }],
                              },
                            ],
                          }
                        : {
                            ...next,
                            contents: [
                              { role: "user", parts: [{ text: "Weather?" }] },
                              reply.candidates[0].content,
                              {
                                role: "user",
                                parts: [
                                  {
                                    functionResponse: {
                                      id: reply.candidates[0].content.parts[0].functionCall.id,
                                      name: "weather",
                                      response: { result: "sunny" },
                                    },
                                  },
                                ],
                              },
                            ],
                          }
                const completed = yield* upstream.expect({
                  transport,
                  response: "text",
                  expect: outgoing(transport, true),
                })
                const second = yield* Effect.promise(() =>
                  fetch(new URL(path(protocol, id, false), app.origin), {
                    method: "POST",
                    headers,
                    body: JSON.stringify(followup),
                  }),
                )
                const answer = yield* Effect.promise(() => second.text())
                expect(second.status, answer).toBe(200)
                expect(answer).toContain("Hello 世界")
                yield* completed.settled
                count++
              }
            }
        yield* upstream.verify
        const records = yield* Effect.tryPromise(() => app.client.usage.records({ limit: 100 }))
        expect(records.data).toHaveLength(count)
        for (const record of records.data) {
          expect(record).toMatchObject({ source: "inference", model: id, upstreamModel: Bedrock.model[transport] })
          expect(record.usage.tokens).toMatchObject(
            transport === "converse"
              ? { input: 10, output: 5, reasoning: 0, cache: { read: 2, write: 1 } }
              : { input: 8, output: 4, reasoning: 1, cache: { read: 2, write: 0 } },
          )
        }
      }).pipe(Effect.scoped),
      { signal },
    )
  }, 120_000)

test("Bedrock rejects unsupported features before inference and renders upstream failures without leaking diagnostics", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const { app, upstream, headers } = yield* Bedrock.make()
      for (const transport of ["converse", "mantle"] as const)
        for (const protocol of protocols) {
          const id = publicID(transport)
          const send = (request: unknown, stream = false) =>
            Effect.promise(() =>
              fetch(new URL(path(protocol, id, stream), app.origin), {
                method: "POST",
                headers,
                body: JSON.stringify(request),
              }),
            )
          const invalid = yield* send({ ...body(protocol, id, false), unknown_feature: true })
          expect(invalid.status).toBe(400)
          yield* upstream.expect({ transport, response: "error", expect: outgoing(transport) })
          const denied = yield* send(body(protocol, id, false))
          const deniedText = yield* Effect.promise(() => denied.text())
          expect(denied.status, deniedText).toBe(403)
          expect(deniedText).toContain("error")
          expect(deniedText).not.toContain("secret")
          for (const response of ["truncated", "exception"] as const) {
            yield* upstream.expect({ transport, response, expect: outgoing(transport) })
            const streamed = yield* send(body(protocol, id, true), true)
            const text = yield* Effect.promise(() => streamed.text())
            expect(text).toContain("error")
            expect(text).not.toContain("secret")
            expect(text).not.toContain("[DONE]")
            expect(text).not.toContain("response.completed")
          }
        }
      yield* upstream.verify
    }).pipe(Effect.scoped),
    { signal },
  )
}, 120_000)

const awaitJSON = (text: string) => JSON.parse(text)

test("client cancellation closes both native upstream streams", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const { app, upstream, headers } = yield* Bedrock.make()
      for (const transport of ["converse", "mantle"] as const) {
        const script = yield* upstream.expect({ transport, response: "cancel", expect: outgoing(transport) })
        const abort = new AbortController()
        const response = yield* Effect.promise(() =>
          fetch(new URL(path("chat", publicID(transport), true), app.origin), {
            method: "POST",
            headers,
            body: JSON.stringify(body("chat", publicID(transport), true)),
            signal: abort.signal,
          }),
        )
        expect(response.status).toBe(200)
        const reader = response.body!.getReader()
        const first = yield* Effect.promise(() => reader.read())
        expect(first.done).toBe(false)
        yield* script.blocked
        abort.abort()
        yield* Effect.promise(() => reader.cancel().catch(() => undefined))
        yield* script.settled
      }
      yield* upstream.verify
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("Gateway uses workspace credentials over a member identity and refreshes the active saved key without retrying failures", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const { app, upstream, headers } = yield* Bedrock.make()
      yield* Effect.tryPromise(() =>
        app.client.integration.connect.awsSigV4({
          integrationID: Bedrock.integrationID,
          scope: "member",
          region: Bedrock.region,
          accessKeyId: "member-identity",
          secretAccessKey: "member-secret",
        }),
      )
      const selected = yield* Effect.tryPromise(() =>
        app.client.integration.get({ integrationID: Bedrock.integrationID }),
      )
      expect(selected?.connections[0]).toMatchObject({ type: "regional-credential", scope: "member" })
      const send = () =>
        Effect.promise(() =>
          fetch(new URL(path("chat", publicID("converse"), false), app.origin), {
            method: "POST",
            headers,
            body: JSON.stringify(body("chat", publicID("converse"), false)),
          }),
        )
      yield* upstream.expect({ transport: "converse", response: "text", expect: outgoing("converse") })
      const first = yield* send()
      expect(first.status).toBe(200)
      yield* Effect.promise(() => first.text())
      yield* Effect.tryPromise(() =>
        app.client.integration.connect.awsSigV4({
          integrationID: Bedrock.integrationID,
          scope: "workspace",
          region: Bedrock.region,
          accessKeyId: "rotated-workspace",
          secretAccessKey: "rotated-secret",
        }),
      )
      yield* upstream.expect({
        transport: "converse",
        response: "error",
        expect: (request) => {
          expect(request.headers.authorization).toContain("Credential=rotated-workspace/")
          expect(request.headers.authorization).not.toContain("member-identity")
        },
      })
      const denied = yield* send()
      expect(denied.status).toBe(403)
      expect(yield* Effect.promise(() => denied.text())).not.toContain("secret")
      expect(yield* upstream.count).toBe(2)
      yield* upstream.verify
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("GovCloud deployment offers us-gov. profiles over FIPS and hides IDs the Region cannot invoke", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const sonnet = "anthropic.claude-sonnet-4-5-20250929-v1:0"
      const gov = `us-gov.${sonnet}`
      const refused = [`us.${sonnet}`, `global.${sonnet}`, sonnet, "anthropic.claude-opus-5"]
      const region = AwsRegion.make("us-gov-west-1")
      const { app, upstream, headers } = yield* Bedrock.make({
        deployment: { region, fips: true },
        models: [gov, ...refused],
      })
      const discovery = yield* Effect.promise(() =>
        fetch(new URL("/inference/openai/v1/models", app.origin), { headers }),
      )
      const ids = (awaitJSON(yield* Effect.promise(() => discovery.text())) as { data: { id: string }[] }).data.map(
        ({ id }) => id,
      )
      expect(ids).toContain(gov)
      for (const id of refused) expect(ids).not.toContain(id)
      expect(ids.some((id) => id.startsWith("us.") || id.startsWith("global."))).toBe(false)

      const step = yield* upstream.expect({
        transport: "converse",
        response: "text",
        expect: (request) => {
          expect(request.url).toBe(
            `https://bedrock-runtime-fips.us-gov-west-1.amazonaws.com/model/${encodeURIComponent(gov)}/converse-stream`,
          )
          expect(request.headers.authorization).toContain("Credential=fixture-workspace/")
          expect(request.headers.authorization).toContain("/us-gov-west-1/bedrock/aws4_request")
          expect(request.headers["x-amz-security-token"]).toBe("fixture-token")
        },
      })
      const response = yield* Effect.promise(() =>
        fetch(new URL(path("chat", gov, false), app.origin), {
          method: "POST",
          headers,
          body: JSON.stringify({ model: gov, messages: [{ role: "user", content: "Weather?" }], max_tokens: 100 }),
        }),
      )
      const text = yield* Effect.promise(() => response.text())
      expect(response.status, text).toBe(200)
      expect(text).toContain("Hello 世界")
      yield* step.settled

      const denied = yield* Effect.promise(() =>
        fetch(new URL(path("chat", `us.${sonnet}`, false), app.origin), {
          method: "POST",
          headers,
          body: JSON.stringify({ model: `us.${sonnet}`, messages: [{ role: "user", content: "Weather?" }] }),
        }),
      )
      expect(denied.ok).toBe(false)
      yield* Effect.promise(() => denied.text())
      expect(yield* upstream.count).toBe(1)
      yield* upstream.verify
    }).pipe(Effect.scoped),
    { signal },
  )
})
