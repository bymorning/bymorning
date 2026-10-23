import { Option, Schema, SchemaGetter } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { expect, test } from "vitest"
import { compile, emitEffectImported, emitEffectShape, emitPromise } from "../src/index.js"

const runPromiseClient = async (
  output: ReturnType<typeof emitPromise>,
  runner: string,
  api?: string,
): Promise<unknown> => {
  const directory = await mkdtemp(join(api === undefined ? tmpdir() : process.cwd(), "httpapi-codegen-"))
  try {
    for (const file of output.files) await writeFile(join(directory, file.path), file.content)
    if (api !== undefined) await writeFile(join(directory, "api.ts"), api)
    await writeFile(join(directory, "runner.ts"), runner)
    const { stdout } = await promisify(execFile)("bun", ["run", "runner.ts"], { cwd: directory })
    return JSON.parse(stdout)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

const runtimeApiSource = `import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"
export const ID = Schema.String.pipe(Schema.brand("Item.ID"))
export const Info = Schema.Struct({ id: ID, createdAt: Schema.DateFromString }).annotate({ identifier: "Item.Info" })
export class MissingError extends Schema.TaggedError<MissingError>()("MissingError", { at: Schema.DateFromString }) {}
const group = HttpApiGroup.make("source.item")
  .add(HttpApiEndpoint.post("create", "/item/:id", {
    params: { id: ID }, query: { page: Schema.NumberFromString }, headers: { "x-schema": Schema.NumberFromString },
    payload: Schema.Struct({ at: Schema.DateFromString }), success: Info, error: MissingError.pipe(HttpApiSchema.status(404)),
  }))
  .add(HttpApiEndpoint.get("text", "/text", { success: Schema.String.pipe(HttpApiSchema.asText()) }))
  .add(HttpApiEndpoint.get("binary", "/binary", { success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()) }))
  .add(HttpApiEndpoint.get("empty", "/empty", { success: HttpApiSchema.NoContent }))
  .add(HttpApiEndpoint.get("events", "/events", { success: HttpApiSchema.StreamSse({ data: Info }) }))
export const Api = HttpApi.make("api").add(group)
`

const runtimeApi = (() => {
  const ID = Schema.String.pipe(Schema.brand("Item.ID"))
  const Info = Schema.Struct({ id: ID, createdAt: Schema.DateFromString }).annotate({ identifier: "Item.Info" })
  class MissingError extends Schema.TaggedError<MissingError>()("MissingError", { at: Schema.DateFromString }) {}
  const group = HttpApiGroup.make("source.item")
    .add(
      HttpApiEndpoint.post("create", "/item/:id", {
        params: { id: ID },
        query: { page: Schema.NumberFromString },
        headers: { "x-schema": Schema.NumberFromString },
        payload: Schema.Struct({ at: Schema.DateFromString }),
        success: Info,
        error: MissingError.pipe(HttpApiSchema.status(404)),
      }),
    )
    .add(HttpApiEndpoint.get("text", "/text", { success: Schema.String.pipe(HttpApiSchema.asText()) }))
    .add(HttpApiEndpoint.get("binary", "/binary", { success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()) }))
    .add(HttpApiEndpoint.get("empty", "/empty", { success: HttpApiSchema.NoContent }))
    .add(HttpApiEndpoint.get("events", "/events", { success: HttpApiSchema.StreamSse({ data: Info }) }))
  return HttpApi.make("api").add(group)
})()

test("does not expand schema references inside string literals", () => {
  const Shared = Schema.Struct({ value: Schema.String }).annotate({ identifier: "Shared" })
  const Api = HttpApi.make("api").add(
    HttpApiGroup.make("test").add(
      HttpApiEndpoint.get("get", "/test", {
        success: Schema.Struct({
          kind: Schema.Literal("Shared"),
          description: Schema.Literal("prefix Shared suffix"),
          shared: Shared,
        }),
      }),
    ),
  )

  const types = emitPromise(compile(Api)).files.find((file) => file.path === "types.ts")?.content

  expect(types).toContain('readonly "kind": "Shared"')
  expect(types).toContain('readonly "description": "prefix Shared suffix"')
  expect(types).toContain('export type Shared = { readonly "value": string }')
  expect(types).toContain('readonly "shared": Shared')
})

test("generates class declarations containing encoded optional fields", () => {
  const optional = <S extends Schema.Top>(schema: S) =>
    Schema.optionalKey(schema).pipe(
      Schema.decodeTo(Schema.optional(Schema.toType(schema)), {
        decode: SchemaGetter.passthrough({ strict: false }),
        encode: SchemaGetter.transformOptional(Option.filter((value) => value !== undefined)),
      }),
    )
  class Entry extends Schema.Class<Entry>("Config.Plugin.Entry")({
    package: Schema.String,
    options: Schema.Record(Schema.String, Schema.Unknown).pipe(optional),
  }) {}
  const Info = Schema.Struct({ plugins: Schema.Array(Schema.Union([Schema.String, Entry])).pipe(optional) })
  const Api = HttpApi.make("api").add(
    HttpApiGroup.make("config").add(
      HttpApiEndpoint.put("update", "/config", { payload: Schema.toEncoded(Info), success: Info }),
    ),
  )

  const shape = emitEffectShape(compile(Api)).files.find((file) => file.path === "api.ts")?.content

  expect(shape).toContain('readonly "plugins"?: ReadonlyArray<string |')
  expect(shape).toContain('readonly "package": string')
  expect(shape).toContain('readonly "options"?: { readonly [x: string]: unknown }')
})

test("adds standard headers to Effect client requests", () => {
  const Api = HttpApi.make("api").add(
    HttpApiGroup.make("test").add(HttpApiEndpoint.get("get", "/test", { success: Schema.String })),
  )

  const client = emitEffectImported(compile(Api), { module: "./api.js", api: "Api" }).files.find(
    (file) => file.path === "client.ts",
  )?.content

  expect(client).toContain("readonly headers?: Headers.Input")
  expect(client).toContain("transformClient:")
  expect(client).toContain("HttpClient.mapRequest(HttpClientRequest.setHeaders(options.headers))")
})

test("generates imported config clients for rc.112 classes without losing constructors or validation", async () => {
  class Entry extends Schema.Class<Entry>("Config.Plugin.Entry")({
    package: Schema.String.check(Schema.isMinLength(1)),
    options: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  }) {}
  const Info = Schema.Struct({ plugins: Schema.Array(Schema.Union([Schema.String, Entry])) })
  const Api = HttpApi.make("api").add(
    HttpApiGroup.make("config").add(HttpApiEndpoint.get("get", "/config", { success: Schema.toType(Info) })),
  )
  const contract = compile(Api)
  const output = emitEffectImported(contract, { module: "./api.js", api: "Api" })
  const shape = emitEffectShape(contract).files.find((file) => file.path === "api.ts")?.content
  expect(shape).toContain('readonly "package": string')
  expect(shape).toContain('readonly "options"?: { readonly [x: string]: unknown }')
  expect(output.files.find((file) => file.path === "client.ts")?.content).toContain('import { Api } from "./api.js"')

  const result = await runPromiseClient(
    output,
    `import { Effect } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Entry } from "./api.js"
import { make } from "./client.js"
const run = (body) => Effect.runPromise(Effect.gen(function* () {
  const client = yield* make({ baseUrl: "http://localhost" })
  return yield* client.config.get().pipe(Effect.match({
    onSuccess: (value) => ({ constructed: value.plugins[0] instanceof Entry, package: value.plugins[0].package }),
    onFailure: (error) => ({ tag: error._tag, cause: error.cause?._tag }),
  }))
}).pipe(Effect.provideService(HttpClient.HttpClient, HttpClient.make((request) =>
  Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  })))
))))
console.log(JSON.stringify([
  await run({ plugins: [{ package: "example" }] }),
  await run({ plugins: [{ package: "" }] }),
]))`,
    `import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
export class Entry extends Schema.Class<Entry>("Config.Plugin.Entry")({
  package: Schema.String.check(Schema.isMinLength(1)),
  options: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
}) {}
const Info = Schema.Struct({ plugins: Schema.Array(Schema.Union([Schema.String, Entry])) })
export const Api = HttpApi.make("api").add(
  HttpApiGroup.make("config").add(HttpApiEndpoint.get("get", "/config", { success: Schema.toType(Info) })),
)`,
  )
  expect(result).toEqual([
    { constructed: true, package: "example" },
    { tag: "ClientError", cause: "SchemaError" },
  ])
})

test("rejects unsupported declarations and custom checks inside class fields", () => {
  const api = (success: Schema.Top) =>
    HttpApi.make("api").add(HttpApiGroup.make("config").add(HttpApiEndpoint.get("get", "/config", { success })))
  const Unsupported = Schema.declare((input): input is string => typeof input === "string")
  class Entry extends Schema.Class<Entry>("Config.Plugin.Entry")({ value: Unsupported }) {}
  class Checked extends Schema.Class<Checked>("Config.Plugin.Checked")({
    value: Schema.String.check(Schema.makeFilter((value) => value !== "unsupported")),
  }) {}
  expect(() => compile(api(Entry))).toThrow()
  expect(() => compile(api(Checked))).toThrow()
})

test("names the complete generated Effect shape ClientApi", () => {
  const Api = HttpApi.make("api").add(
    HttpApiGroup.make("test").add(HttpApiEndpoint.get("get", "/test", { success: Schema.String })),
  )

  const shape = emitEffectShape(compile(Api)).files.find((file) => file.path === "api.ts")?.content

  expect(shape).toContain("export interface ClientApi<E = never>")
  expect(shape).not.toContain("AppApi")
})

test("generates optional payloads for bodyless-or-JSON endpoint alternatives", () => {
  const Api = HttpApi.make("api").add(
    HttpApiGroup.make("session").add(
      HttpApiEndpoint.post("create", "/session", {
        payload: [Schema.Undefined, Schema.Struct({})],
        success: Schema.String,
      }),
    ),
  )

  const output = emitPromise(compile(Api))
  expect(output.files.find((file) => file.path === "types.ts")?.content).toContain(
    'export type SessionCreateInput = { readonly "payload"?: undefined | {  } }',
  )
  expect(output.files.find((file) => file.path === "client.ts")?.content).toContain('body: input?.["payload"]')
})

test("runtime Promise clients send binary request bodies directly with binary content types", async () => {
  const ContentType = Schema.Struct({ contentType: Schema.optionalKey(Schema.String) }).pipe(
    Schema.encodeKeys({ contentType: "content-type" }),
  )
  const Api = HttpApi.make("api").add(
    HttpApiGroup.make("upload").add(
      HttpApiEndpoint.put("put", "/upload", {
        headers: ContentType,
        payload: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
        success: HttpApiSchema.NoContent,
      }),
    ),
  )
  const output = emitPromise(compile(Api), { runtime: { module: "./api.ts", api: "Api" } })
  const result = await runPromiseClient(
    output,
    `import { make } from "./client.ts"
const seen: Array<unknown> = []
const client = make({ baseUrl: "https://example.test", fetch: async (_url, init) => {
  seen.push({ contentType: new Headers(init?.headers).get("content-type"), body: Array.from(init?.body as Uint8Array) })
  return new Response(null, { status: 204 })
} })
await client.upload.put({ payload: Uint8Array.from([0, 255, 1]) })
await client.upload.put({ payload: Uint8Array.from([2, 3]), contentType: "image/png" })
console.log(JSON.stringify(seen))`,
    `import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"
const ContentType = Schema.Struct({ contentType: Schema.optionalKey(Schema.String) }).pipe(Schema.encodeKeys({ contentType: "content-type" }))
export const Api = HttpApi.make("api").add(HttpApiGroup.make("upload").add(HttpApiEndpoint.put("put", "/upload", {
  headers: ContentType, payload: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()), success: HttpApiSchema.NoContent,
    })))`,
  )
  const standalone = await runPromiseClient(
    emitPromise(compile(Api)),
    `import { make } from "./client.ts"
const client = make({ baseUrl: "https://example.test", fetch: async (_url, init) => {
  console.log(JSON.stringify({ contentType: new Headers(init?.headers).get("content-type"), body: Array.from(init?.body as Uint8Array) }))
  return new Response(null, { status: 204 })
} })
await client.upload.put({ payload: Uint8Array.from([4, 5]) }, { headers: { "content-type": "image/gif" } })`,
  )

  expect(result).toEqual([
    { contentType: "application/octet-stream", body: [0, 255, 1] },
    { contentType: "image/png", body: [2, 3] },
  ])
  expect(standalone).toEqual({ contentType: "image/gif", body: [4, 5] })
})

test("generates valid index signatures for open payloads with optional fields", () => {
  const Payload = Schema.StructWithRest(
    Schema.Struct({ model: Schema.String, stream: Schema.optionalKey(Schema.Boolean) }),
    [Schema.Record(Schema.String, Schema.Json)],
  )
  const Api = HttpApi.make("api").add(
    HttpApiGroup.make("ai").add(
      HttpApiEndpoint.post("responses", "/responses", { payload: Payload, success: Schema.String }),
    ),
  )

  const output = emitPromise(compile(Api))
  const types = output.files.find((file) => file.path === "types.ts")?.content

  expect(types).toContain('readonly "stream"?: boolean } & { readonly [x: string]: JsonValue')
  expect(output.files.find((file) => file.path === "client.ts")?.content).toContain('body: input["payload"]')
})

test("separates source and public group names across emitters", () => {
  const Api = HttpApi.make("api").add(
    HttpApiGroup.make("api.provider").add(
      HttpApiEndpoint.get("provider.list", "/providers", { success: Schema.String }),
    ),
  )
  const contract = compile(Api, { groupNames: { "api.provider": "provider" } })

  expect(contract.groups[0]?.identifier).toBe("provider")
  expect(contract.groups[0]?.sourceIdentifier).toBe("api.provider")
  expect(contract.groups[0]?.endpoints[0]?.clientPath).toEqual(["list"])
  expect(emitPromise(contract).files.find((file) => file.path === "client.ts")?.content).toContain(
    '"provider": { "list":',
  )
  const effect = emitEffectImported(contract, { module: "./api.js", api: "Api" }).files.find(
    (file) => file.path === "client.ts",
  )?.content
  expect(effect).toContain('raw["api.provider"]')
  expect(effect).toContain('"provider": adaptGroup0(raw["api.provider"])')
})

test("derives endpoint paths from source group identifiers", () => {
  const Api = HttpApi.make("api").add(
    HttpApiGroup.make("api.model-definition").add(
      HttpApiEndpoint.get("internal.list", "/model-definitions", { success: Schema.String }).annotateMerge(
        OpenApi.annotations({ identifier: "v2.model-definition.catalog.list" }),
      ),
    ),
  )

  expect(
    compile(Api, { groupNames: { "api.model-definition": "modelDefinition" } }).groups[0]?.endpoints[0]?.clientPath,
  ).toEqual(["catalog", "list"])
})

test("rejects duplicate and leaf-namespace endpoint paths", () => {
  const duplicate = HttpApi.make("api").add(
    HttpApiGroup.make("session")
      .add(
        HttpApiEndpoint.get("first", "/first", { success: Schema.String }).annotateMerge(
          OpenApi.annotations({ identifier: "session.instructions.list" }),
        ),
      )
      .add(
        HttpApiEndpoint.get("second", "/second", { success: Schema.String }).annotateMerge(
          OpenApi.annotations({ identifier: "session.instructions.list" }),
        ),
      ),
  )
  expect(() => compile(duplicate)).toThrow("Client endpoint name collision: session.instructions.list")

  const leafNamespace = HttpApi.make("api").add(
    HttpApiGroup.make("session")
      .add(
        HttpApiEndpoint.get("first", "/first", { success: Schema.String }).annotateMerge(
          OpenApi.annotations({ identifier: "session.instructions" }),
        ),
      )
      .add(
        HttpApiEndpoint.get("second", "/second", { success: Schema.String }).annotateMerge(
          OpenApi.annotations({ identifier: "session.instructions.list" }),
        ),
      ),
  )
  expect(() => compile(leafNamespace)).toThrow("Client endpoint name collision: session.instructions.list")
})

test("rejects normalized group and endpoint type collisions", () => {
  const groups = HttpApi.make("api")
    .add(HttpApiGroup.make("foo-bar").add(HttpApiEndpoint.get("get", "/first", { success: Schema.String })))
    .add(HttpApiGroup.make("foo.bar").add(HttpApiEndpoint.get("get", "/second", { success: Schema.String })))
  expect(() => compile(groups)).toThrow("Client group type collision: FooBar")

  const endpoints = HttpApi.make("api").add(
    HttpApiGroup.make("session")
      .add(
        HttpApiEndpoint.get("first", "/first", { success: Schema.String }).annotateMerge(
          OpenApi.annotations({ identifier: "session.foo.bar" }),
        ),
      )
      .add(
        HttpApiEndpoint.get("second", "/second", { success: Schema.String }).annotateMerge(
          OpenApi.annotations({ identifier: "session.foo-bar" }),
        ),
      ),
  )
  expect(() => compile(endpoints)).toThrow("Client endpoint type collision: SessionFooBar")
})

test("rejects operation-key, projected group, and prototype collisions", () => {
  const operationKey = HttpApi.make("api")
    .add(
      HttpApiGroup.make("a.b").add(
        HttpApiEndpoint.get("get", "/first", { success: Schema.String }).annotateMerge(
          OpenApi.annotations({ identifier: "a.b.c" }),
        ),
      ),
    )
    .add(
      HttpApiGroup.make("a").add(
        HttpApiEndpoint.get("b.c", "/second", { success: Schema.String }).annotateMerge(
          OpenApi.annotations({ identifier: "a.b.c" }),
        ),
      ),
    )
  expect(() => compile(operationKey)).toThrow("Client operation key collision: a.b.c")

  const projected = HttpApi.make("api")
    .add(HttpApiGroup.make("first").add(HttpApiEndpoint.get("one", "/one", { success: Schema.String })))
    .add(HttpApiGroup.make("second").add(HttpApiEndpoint.get("two", "/two", { success: Schema.String })))
  expect(() => compile(projected, { groupNames: { first: "same", second: "same" } })).toThrow(
    "Client group name collision: same",
  )
  expect(() => compile(projected, { groupNames: { first: "__proto__" } })).toThrow(
    "Client group name cannot be __proto__",
  )

  const endpointPrototype = HttpApi.make("api").add(
    HttpApiGroup.make("session").add(
      HttpApiEndpoint.get("get", "/session", { success: Schema.String }).annotateMerge(
        OpenApi.annotations({ identifier: "session.__proto__.get" }),
      ),
    ),
  )
  expect(() => compile(endpointPrototype)).toThrow("Client endpoint path cannot contain __proto__")
})

test("emits incremental AsyncIterable output for JSON SSE data", () => {
  const Api = HttpApi.make("api").add(
    HttpApiGroup.make("event").add(
      HttpApiEndpoint.get("event.subscribe", "/event", {
        success: HttpApiSchema.StreamSse({
          data: Schema.Struct({ created: Schema.DateTimeUtcFromString, text: Schema.String }),
        }),
      }),
    ),
  )

  const output = emitPromise(compile(Api))
  const types = output.files.find((file) => file.path === "types.ts")?.content
  const client = output.files.find((file) => file.path === "client.ts")?.content

  expect(types).toContain('export type EventSubscribeOutput = { readonly "created": string, readonly "text": string }')
  expect(client).toContain("AsyncIterable<EventSubscribeOutput>")
})

test("parses chunked SSE data, ignores comments, and cancels on iterator return", async () => {
  const Api = HttpApi.make("api").add(
    HttpApiGroup.make("event").add(
      HttpApiEndpoint.get("event.subscribe", "/event", {
        success: HttpApiSchema.StreamSse({ data: Schema.Struct({ value: Schema.Number }) }),
      }),
    ),
  )
  const result = await runPromiseClient(
    emitPromise(compile(Api)),
    `import { make } from "./client.ts"
let cancelled = false
const encoder = new TextEncoder()
const chunks = [": heart", "beat\\r\\n\\r\\ndata: {\\"val", "ue\\":1}\\r", "\\n\\r\\ndata: {\\"value\\":2}\\n\\n"]
const body = new ReadableStream<Uint8Array>({
  pull(controller) { const chunk = chunks.shift(); if (chunk !== undefined) controller.enqueue(encoder.encode(chunk)) },
  cancel() { cancelled = true },
})
const client = make({ baseUrl: "https://example.test", fetch: async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }) })
const iterator = client.event.subscribe()[Symbol.asyncIterator]()
const first = await iterator.next()
await iterator.return?.()
console.log(JSON.stringify({ first, cancelled }))`,
  )

  expect(result).toEqual({ first: { value: { value: 1 }, done: false }, cancelled: true })
})

test("propagates AbortSignal to SSE fetch", async () => {
  const Api = HttpApi.make("api").add(
    HttpApiGroup.make("event").add(
      HttpApiEndpoint.get("event.subscribe", "/event", {
        success: HttpApiSchema.StreamSse({ data: Schema.String }),
      }),
    ),
  )
  const result = await runPromiseClient(
    emitPromise(compile(Api)),
    `import { make } from "./client.ts"
const controller = new AbortController()
let fetchSignal: AbortSignal | null = null
const client = make({ baseUrl: "https://example.test", fetch: (_url, init) => {
  fetchSignal = init?.signal as AbortSignal
  return new Promise((_resolve, reject) => fetchSignal?.addEventListener("abort", () => reject(fetchSignal?.reason), { once: true })) as Promise<Response>
} })
const pending = client.event.subscribe({ signal: controller.signal })[Symbol.asyncIterator]().next()
await Promise.resolve()
controller.abort(new Error("stop"))
let reason = ""
try { await pending } catch (error) { reason = error instanceof Error && "reason" in error ? String(error.reason) : "unknown" }
console.log(JSON.stringify({ reason, aborted: fetchSignal?.aborted }))`,
  )

  expect(result).toEqual({ reason: "Transport", aborted: true })
})

test("classifies an AbortSignal interruption after SSE connection as transport failure", async () => {
  const Api = HttpApi.make("api").add(
    HttpApiGroup.make("event").add(
      HttpApiEndpoint.get("event.subscribe", "/event", {
        success: HttpApiSchema.StreamSse({ data: Schema.String }),
      }),
    ),
  )
  const result = await runPromiseClient(
    emitPromise(compile(Api)),
    `import { make } from "./client.ts"
const external = new AbortController()
const client = make({ baseUrl: "https://example.test", fetch: async (_url, init) => new Response(new ReadableStream({
  start(controller) { init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true }) },
}), { status: 200, headers: { "content-type": "text/event-stream" } }) })
const pending = client.event.subscribe({ signal: external.signal })[Symbol.asyncIterator]().next()
await Promise.resolve()
external.abort(new Error("stop"))
let reason = ""
try { await pending } catch (error) { reason = error instanceof Error && "reason" in error ? String(error.reason) : "unknown" }
console.log(JSON.stringify({ reason }))`,
  )

  expect(result).toEqual({ reason: "Transport" })
})

test("reports operation metadata shared by Promise and Effect emitters", () => {
  const Api = HttpApi.make("api").add(
    HttpApiGroup.make("session").add(
      HttpApiEndpoint.get("list", "/session", {
        query: { limit: Schema.optional(Schema.Number) },
        success: Schema.Array(Schema.String),
      }),
    ),
  )
  const contract = compile(Api)
  const promise = emitPromise(contract)
  const effect = emitEffectImported(contract, { module: "./api.js", api: "Api" })

  expect(promise.operations).toEqual(effect.operations)
  expect(promise.operations[0]).toMatchObject({
    group: "session",
    name: "list",
    input: [{ name: "limit", source: "query" }],
    inputMode: "optional",
    success: "value",
  })
})

test("emits mutable Promise outputs without making inputs mutable", () => {
  const Api = HttpApi.make("api").add(
    HttpApiGroup.make("session").add(
      HttpApiEndpoint.post("create", "/session", {
        payload: Schema.Struct({ values: Schema.Array(Schema.String) }),
        success: Schema.Struct({ data: Schema.Array(Schema.Struct({ values: Schema.Array(Schema.String) })) }),
      }),
    ),
  )
  const types = emitPromise(compile(Api), { mutableOutputs: true }).files.find(
    (file) => file.path === "types.ts",
  )?.content

  expect(types).toContain('readonly "values": ReadonlyArray<string>')
  expect(types).toContain('export type SessionCreateOutput = ({ "data": Array<{ "values": Array<string> }> })["data"]')
})

test("emits declared Promise error guards and preserved statuses", () => {
  class MissingError extends Schema.TaggedError<MissingError>()("MissingError", {
    message: Schema.String,
    detail: Schema.String.pipe(Schema.optional),
  }) {}
  const Api = HttpApi.make("api").add(
    HttpApiGroup.make("session").add(
      HttpApiEndpoint.get("get", "/session", {
        success: Schema.String,
        error: MissingError.pipe(HttpApiSchema.status(404)),
      }),
    ),
  )
  const output = emitPromise(compile(Api))
  const types = output.files.find((file) => file.path === "types.ts")?.content
  const client = output.files.find((file) => file.path === "client.ts")?.content

  expect(types).toContain('readonly "detail"?: string')
  expect(types).toContain("export const isMissingError")
  expect(client).toContain("declaredStatuses: [404]")
})

test("supports trailing Promise wildcards and top-level Effect shapes", () => {
  const Api = HttpApi.make("api").add(
    HttpApiGroup.make("system", { topLevel: true }).add(
      HttpApiEndpoint.get("read", "/file/*", {
        success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
      }),
    ),
  )
  const contract = compile(Api)
  const promise = emitPromise(contract)
  const shape = emitEffectShape(contract).files[0]?.content

  expect(promise.operations[0]).toMatchObject({ input: [{ name: "path", source: "wildcard" }] })
  expect(promise.files.find((file) => file.path === "client.ts")?.content).toContain(
    "`/file/${encodePath(input.path)}`",
  )
  expect(shape).toContain('readonly "read": SystemReadOperation<E>')
  expect(shape).not.toContain('readonly "system":')
})

test("runtime Promise mode emits decoded branded and named types", () => {
  const output = emitPromise(compile(runtimeApi, { groupNames: { "source.item": "item" } }), {
    mutableOutputs: true,
    runtime: { module: "./api.ts", api: "Api" },
  })
  const types = output.files.find((file) => file.path === "types.ts")?.content

  expect(types).toContain('import type * as Brand from "effect/Brand"')
  expect(types).toContain("export type ItemInfo =")
  expect(types).toContain('Brand.Brand<"Item.ID">')
  expect(types).toContain('"createdAt": globalThis.Date')
  expect(types).toContain('readonly "at": globalThis.Date')
})

test("runtime clients use plain string keys for branded JSON records", () => {
  const ID = Schema.String.pipe(Schema.brand("Item.ID"))
  const Api = HttpApi.make("api").add(
    HttpApiGroup.make("item").add(
      HttpApiEndpoint.get("active", "/item/active", {
        success: Schema.Record(ID, Schema.Struct({ type: Schema.Literal("running") })),
      }),
    ),
  )
  const contract = compile(Api)
  const promise = emitPromise(contract, { mutableOutputs: true, runtime: { module: "./api.ts", api: "Api" } })
  const promiseTypes = promise.files.find((file) => file.path === "types.ts")?.content
  const effectTypes = emitEffectShape(contract).files[0]?.content

  expect(promiseTypes).toContain("{ [x: string]:")
  expect(effectTypes).toContain("{ readonly [x: string]:")
  expect(promiseTypes).not.toContain('[x: string & Brand.Brand<"Item.ID">]')
  expect(effectTypes).not.toContain('[x: string & Brand.Brand<"Item.ID">]')
})

test("runtime Promise mode omits absent optional request fields", async () => {
  const Api = HttpApi.make("api").add(
    HttpApiGroup.make("session").add(
      HttpApiEndpoint.get("list", "/session", {
        query: { cursor: Schema.optional(Schema.String) },
        success: Schema.Array(Schema.String),
      }),
    ),
  )
  const output = emitPromise(compile(Api), { runtime: { module: "./api.ts", api: "Api" } })
  const result = await runPromiseClient(
    output,
    `import { make } from "./client.ts"
const client = make({ baseUrl: "https://example.test", fetch: async (url) => {
  console.log(JSON.stringify({ url: String(url) }))
  return Response.json([])
} })
await client.session.list()`,
    `import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
export const Api = HttpApi.make("api").add(HttpApiGroup.make("session").add(HttpApiEndpoint.get("list", "/session", {
  query: { cursor: Schema.optional(Schema.String) }, success: Schema.Array(Schema.String),
})))`,
  )

  expect(result).toEqual({ url: "https://example.test/session" })
})

test("runtime Promise mode encodes requests and preserves additive response fields", async () => {
  const output = emitPromise(compile(runtimeApi, { groupNames: { "source.item": "item" } }), {
    runtime: { module: "./api.ts", api: "Api" },
  })
  const result = await runPromiseClient(
    output,
    `import { ID } from "./api.ts"
import { make } from "./client.ts"
const seen: Array<unknown> = []
const fetch = async (url: URL | RequestInfo, init?: RequestInit) => {
  const headers = new Headers(init?.headers)
  const mode = headers.get("x-case")
  seen.push({ url: String(url), schema: headers.get("x-schema"), global: headers.get("x-global"), request: headers.get("x-request"), body: init?.body })
  if (mode === "declared") return Response.json({ _tag: "MissingError", at: "2026-01-02T00:00:00.000Z" }, { status: 404 })
  if (mode === "bad-declared") return Response.json({ _tag: "MissingError", at: "bad" }, { status: 404 })
  if (mode === "strict") return Response.json({ id: "item-1", createdAt: "2026-01-01T00:00:00.000Z", extra: true })
  if (mode === "malformed") return new Response("{", { headers: { "content-type": "application/json" } })
  if (mode === "content") return new Response("ok", { headers: { "content-type": "text/plain" } })
  if (mode === "status") return new Response(null, { status: 503 })
  return Response.json({ id: "item-1", createdAt: "2026-01-01T00:00:00.000Z" })
}
const client = make({ baseUrl: "https://example.test", fetch: fetch as typeof globalThis.fetch, headers: { "x-global": "yes" } })
const input = { id: ID.make("item-1"), page: 3, "x-schema": 4, at: new Date("2026-01-03T00:00:00.000Z") }
const ok = await client.item.create(input, { headers: { "x-request": "yes" } })
const failure = async (mode: string) => { try { return await client.item.create(input, { headers: { "x-case": mode } }) } catch (error) {
  if (typeof error === "object" && error !== null && "_tag" in error) return String(error._tag) + ":" + String("at" in error && error.at instanceof Date)
  return error instanceof Error && "reason" in error ? String(error.reason) : "unknown"
} }
console.log(JSON.stringify({ okDate: ok.createdAt instanceof Date, seen: seen[0], declared: await failure("declared"), badDeclared: await failure("bad-declared"), strict: await failure("strict"), malformed: await failure("malformed"), content: await failure("content"), status: await failure("status") }))`,
    runtimeApiSource,
  )

  expect(result).toEqual({
    okDate: true,
    seen: {
      url: "https://example.test/item/item-1?page=3",
      schema: "4",
      global: "yes",
      request: "yes",
      body: '{"at":"2026-01-03T00:00:00.000Z"}',
    },
    declared: "MissingError:true",
    badDeclared: "Schema",
    strict: { id: "item-1", createdAt: "2026-01-01T00:00:00.000Z", extra: true },
    malformed: "MalformedResponse",
    content: "UnsupportedContentType",
    status: "UnexpectedStatus",
  })
})

test("runtime Promise mode handles empty, text, binary, and decoded SSE responses", async () => {
  const output = emitPromise(compile(runtimeApi, { groupNames: { "source.item": "item" } }), {
    runtime: { module: "./api.ts", api: "Api" },
  })
  const result = await runPromiseClient(
    output,
    `import { make } from "./client.ts"
const encoder = new TextEncoder()
let eventMode = "valid"
const client = make({ baseUrl: "https://example.test", fetch: (async (url) => {
  const path = new URL(String(url)).pathname
  if (path === "/empty") return new Response(null, { status: 204 })
  if (path === "/text") return new Response("hello", { headers: { "content-type": "text/plain; charset=utf-8" } })
  if (path === "/binary") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "application/octet-stream" } })
  const valid = JSON.stringify({ id: "item-1", createdAt: "2026-01-01T00:00:00.000Z" })
  if (eventMode === "chunked") {
    const piece = encoder.encode("x".repeat(1024 * 1024))
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode("data: \\"")); for (let index = 0; index < 17; index++) controller.enqueue(piece); controller.enqueue(encoder.encode("\\"\\n\\n")); controller.close() } }), { headers: { "content-type": "text/event-stream" } })
  }
  if (eventMode === "many") {
    const line = encoder.encode("data: " + JSON.stringify({ id: "x".repeat(1024 * 1024), createdAt: "2026-01-01T00:00:00.000Z" }) + "\\n\\n")
    return new Response(new ReadableStream({ start(controller) { for (let index = 0; index < 20; index++) controller.enqueue(line); controller.close() } }), { headers: { "content-type": "text/event-stream" } })
  }
  const value = eventMode === "valid" ? valid : eventMode === "schema" ? JSON.stringify({ id: "item-1", createdAt: "bad" }) : eventMode === "json" ? "{" : JSON.stringify("x".repeat(16 * 1024 * 1024 + 1))
  return new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode("data: " + value + "\\n\\n")); controller.close() } }), { headers: { "content-type": "text/event-stream" } })
}) as typeof globalThis.fetch })
const one = async () => (await client.item.events()[Symbol.asyncIterator]().next()).value
const failure = async (mode: string) => { eventMode = mode; try { await one(); return "none" } catch (error) { return error instanceof Error && "reason" in error ? String(error.reason) : "unknown" } }
const count = async (mode: string) => { eventMode = mode; let total = 0; for await (const _ of client.item.events()) total++; return total }
const valid = await one()
console.log(JSON.stringify({ empty: await client.item.empty(), text: await client.item.text(), binary: Array.from(await client.item.binary()), eventDate: valid.createdAt instanceof Date, schema: await failure("schema"), json: await failure("json"), oversize: await failure("oversize"), chunked: await failure("chunked"), many: await count("many") }))`,
    runtimeApiSource,
  )

  expect(result).toEqual({
    text: "hello",
    binary: [1, 2, 3],
    eventDate: true,
    schema: "Schema",
    json: "MalformedResponse",
    oversize: "SseEventTooLarge",
    chunked: "SseEventTooLarge",
    many: 20,
  })
})
