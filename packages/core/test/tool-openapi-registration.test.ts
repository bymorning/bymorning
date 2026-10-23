import { describe, expect, it } from "@effect/vitest"
import * as OpenAPI from "@bymorning/plugin/effect/openapi"
import { User } from "@bymorning/schema/user"
import { OpenAPI as CodeModeOpenAPI, Tool as CodeModeTool } from "@opencode-ai/codemode"
import { Cause, Effect, Exit, Option, Schema, Scope } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import type { Integration } from "../src/integration.js"
import { PluginHooks } from "../src/plugin/hooks.js"
import { State } from "../src/state.js"
import { Tool } from "../src/tool.js"
import { register } from "../src/tool/openapi.js"

const origin = "https://api.example"
const document = (...names: string[]): CodeModeOpenAPI.Document => ({
  openapi: "3.0.0",
  info: { title: "Registration", version: "1" },
  servers: [{ url: origin }],
  paths: Object.fromEntries(names.map((operationId, index) => [`/operation-${index}`, {
    get: { operationId, responses: { "200": { description: "ok" } } },
  }])),
})
const options = (overrides: Partial<OpenAPI.Options> = {}): OpenAPI.Options => ({
  namespace: "registration",
  permissionPrefix: "registration",
  expectedOrigin: origin,
  baseURL: origin,
  authentication: { type: "none" },
  spec: document("ping"),
  ...overrides,
})

const fixture = Effect.gen(function* () {
  const tools = yield* Tool.make
  const calls = { registration: 0, integrationWrite: 0, credentialRead: 0, http: 0, active: [] as Integration.ID[] }
  const forbidden = () => Effect.sync(() => { calls.integrationWrite++ }).pipe(Effect.andThen(Effect.die("Unexpected Integration mutation")))
  // Deliberately expose the real connection interface, not a cast partial service.
  // No Credential or Integration registration authority is needed by the adapter.
  const integration: Pick<Integration.Interface, "connection" | "transform"> = {
    transform: forbidden,
    connection: {
      active: (id) => Effect.sync(() => { calls.active.push(id); return undefined }),
      resolve: () => Effect.sync(() => { calls.credentialRead++; return undefined }),
      key: forbidden,
      awsSigV4: forbidden,
      values: forbidden,
      activate: forbidden,
      update: forbidden,
      remove: forbidden,
    },
  }
  const http = HttpClient.make((request) => Effect.sync(() => {
    calls.http++
    return HttpClientResponse.fromWeb(request, new Response(null, { status: 204 }))
  }))
  const install = (input: OpenAPI.Options) => register({
    options: input,
    integration,
    http,
    tool: {
      transform: (callback) => Effect.sync(() => { calls.registration++ }).pipe(Effect.andThen(tools.transform(callback))),
    },
  })
  // Observe the real admitted registry through its editor, without replacing it.
  const entries = () => Effect.gen(function* () {
    let values: ReturnType<Tool.Editor["list"]> = []
    const observation = yield* tools.transform((editor) => { values = editor.list() })
    yield* observation.dispose
    return values
  })
  return { tools, calls, install, entries }
})
const provide = <A, E>(effect: Effect.Effect<A, E, PluginHooks.Service | Scope.Scope>) =>
  effect.pipe(Effect.scoped, Effect.provide(PluginHooks.layer))

const setupError = <A, E>(exit: Exit.Exit<A, E>) => {
  expect(Exit.isFailure(exit), "invalid setup must fail, not return a successful registration").toBe(true)
  if (!Exit.isFailure(exit)) return
  expect(Cause.hasDies(exit.cause), "setup errors must be typed failures, not defects").toBe(false)
  expect(Option.getOrUndefined(Cause.findErrorOption(exit.cause))).toBeInstanceOf(OpenAPI.Error)
}

describe("Tool.OpenAPI registration", () => {
  it("uses the converter's actual normalized paths, including leading digits", () => {
    const generated = CodeModeOpenAPI.fromSpec({ spec: document("123start", "users.list", "has-hyphen", "constructor") })
    expect(Object.keys(generated.tools)).toEqual(["_123start", "users", "has_hyphen", "constructor_2"])
    const users = generated.tools.users
    expect(users !== undefined && !CodeModeTool.isTool(users) && Object.keys(users)).toEqual(["list"])
    expect(generated.skipped).toEqual([])
  })

  it.effect("keeps safe upstream leading-digit names rather than colliding with operation_ aliases", () =>
    provide(Effect.gen(function* () {
      const test = yield* fixture
      const summary = yield* test.install(options({ spec: document("123start", "operation_123start") }))
      // Core Tool accepts the converter's leading underscore (tool.ts registrationError).
      expect(summary.operationNames).toEqual(["_123start", "operation_123start"])
      expect((yield* test.entries()).map((entry) => entry.name)).toEqual(summary.operationNames)
    })),
  )

  it.effect("admits converter names and same-origin base paths without additional renaming", () =>
    provide(Effect.gen(function* () {
      const test = yield* fixture
      const summary = yield* test.install(options({
        baseURL: `${origin}/v1/`,
        spec: document("users.list", "has-hyphen", "constructor", "_already_safe"),
      }))
      expect(summary.operationNames).toEqual(["users_list", "has_hyphen", "constructor_2", "already_safe"])
      expect((yield* test.entries()).map((entry) => entry.name)).toEqual(summary.operationNames)
      expect(summary.skipped).toEqual([])
      expect(test.calls.http).toBe(0)
    })),
  )

  it.effect("still confines document-selected servers at invocation when baseURL is omitted", () =>
    provide(Effect.gen(function* () {
      const test = yield* fixture
      const { baseURL: _, ...input } = options({
        spec: { ...document("ping"), servers: [{ url: "https://elsewhere.example" }] },
      })
      yield* test.install(input)
      const entry = (yield* test.entries())[0]
      expect(entry).toBeDefined()
      if (entry === undefined) return
      const error = yield* entry.execute({}, {
        caller: { type: "gateway", userID: User.ID.make("usr_registration") },
        id: Tool.CallID.make("origin-call"),
        elicit: () => Effect.die("unused"),
        permission: () => Effect.void,
        progress: () => Effect.void,
      }).pipe(Effect.flip)
      expect(error.message).toBe("registration request failed")
      expect(test.calls.http).toBe(0)
    })),
  )

  for (const [label, names] of [
    ["long names sharing the first 64 characters", [`${"x".repeat(64)}First`, `${"x".repeat(64)}Second`]],
    ["distinct namespace paths that flatten to the same name", ["users.list", "users_list"]],
  ] as const) {
    it.effect(`does not silently overwrite ${label}`, () =>
      provide(Effect.gen(function* () {
        const test = yield* fixture
        const result = yield* test.install(options({ spec: document("valid_first", ...names) })).pipe(Effect.exit)
        setupError(result)
        expect(yield* test.entries()).toEqual([])
        expect(test.calls.registration).toBe(0)
      })),
    )
  }

  const invalid: ReadonlyArray<readonly [string, Partial<OpenAPI.Options>]> = [
    ["unparseable expectedOrigin", { expectedOrigin: "not an origin" }],
    ["non-HTTP expectedOrigin", { expectedOrigin: "file:///private" }],
    ["expectedOrigin with a path", { expectedOrigin: `${origin}/api` }],
    ["expectedOrigin with credentials", { expectedOrigin: "https://setup-user:setup-secret@api.example" }],
    ["expectedOrigin with a query", { expectedOrigin: `${origin}?setup-secret` }],
    ["expectedOrigin with a fragment", { expectedOrigin: `${origin}#setup-secret` }],
    ["relative baseURL", { baseURL: "/api" }],
    ["non-HTTP baseURL", { baseURL: "ftp://api.example" }],
    ["baseURL with a query", { baseURL: `${origin}?key=setup-secret` }],
    ["baseURL with a fragment", { baseURL: `${origin}#setup-secret` }],
    ["baseURL with credentials", { baseURL: "https://setup-user:setup-secret@api.example/v1" }],
    ["baseURL with empty userinfo", { baseURL: "https://@api.example/v1" }],
    ["baseURL with parser-repaired whitespace", { baseURL: ` ${origin}/v1` }],
    ["baseURL at another origin", { baseURL: "https://elsewhere.example/v1" }],
    ["invalid namespace", { namespace: "invalid namespace" }],
    ["non-string permissionPrefix", { permissionPrefix: 42 as unknown as string }],
    ["empty permissionPrefix", { permissionPrefix: "" }],
    ["blank permissionPrefix", { permissionPrefix: " " }],
    ["null document", { spec: null as unknown as CodeModeOpenAPI.Document }],
    ["null authentication", { authentication: null as unknown as OpenAPI.Authentication }],
    ["unknown authentication discriminator", { authentication: { type: "secret", value: "setup-secret" } as unknown as OpenAPI.Authentication }],
    ["non-string Integration reference", { authentication: { type: "integration", integrationID: 42, schemes: {} } as unknown as OpenAPI.Authentication }],
    ["null scheme map", { authentication: { type: "integration", integrationID: "existing", schemes: null } as unknown as OpenAPI.Authentication }],
    ["unknown scheme discriminator", { authentication: { type: "integration", integrationID: "existing", schemes: { api: { type: "secret", value: "setup-secret" } } } as unknown as OpenAPI.Authentication }],
    ["non-string basic configuration field", { authentication: { type: "integration", integrationID: "existing", schemes: { api: { type: "basic", username: 42 } } } as unknown as OpenAPI.Authentication }],
  ]
  for (const [label, overrides] of invalid) {
    it.effect(`rejects ${label} before registration, HTTP, or authentication reads`, () =>
      provide(Effect.gen(function* () {
        const test = yield* fixture
        const result = yield* test.install(options(overrides)).pipe(Effect.exit)
        // Check side effects even when the implementation returned success.
        expect.soft(test.calls).toEqual({ registration: 0, integrationWrite: 0, credentialRead: 0, http: 0, active: [] })
        expect.soft(yield* test.entries()).toEqual([])
        if (Exit.isFailure(result)) expect(Cause.pretty(result.cause)).not.toContain("setup-secret")
        setupError(result)
      })),
    )
  }

  it.effect("reports malformed document security as skipped, not a setup defect", () =>
    provide(Effect.gen(function* () {
      const test = yield* fixture
      const summary = yield* test.install(options({ spec: { ...document("ping"), security: "not an array" } }))
      expect(summary.operationNames).toEqual([])
      expect(summary.skipped).toEqual([{ method: "GET", path: "/operation-0", reason: expect.stringMatching(/security/) }])
      expect(yield* test.entries()).toEqual([])
      expect(test.calls.active).toEqual([])
      expect(test.calls.http).toBe(0)
    })),
  )

  it.effect("disposes the complete registration idempotently and reveals earlier tools", () =>
    provide(Effect.gen(function* () {
      const test = yield* fixture
      yield* test.tools.transform((editor) => editor.add({
        name: "ping", description: "earlier", input: Schema.Struct({}),
        options: { namespace: "registration" }, execute: () => Effect.succeed({ output: "earlier" }),
      }))
      const summary = yield* test.install(options({ spec: document("ping", "second") }))
      expect((yield* test.entries()).map((entry) => entry.name)).toEqual(["ping", "second"])
      yield* summary.dispose
      yield* summary.dispose
      expect((yield* test.entries()).map((entry) => [entry.name, entry.description])).toEqual([["ping", "earlier"]])
    })),
  )

  it.effect("removes every contribution after a later batched setup registration fails", () =>
    provide(Effect.gen(function* () {
      const test = yield* fixture
      const result = yield* Effect.scoped(State.batch(Effect.gen(function* () {
        yield* test.install(options({ spec: document("first", "second") }))
        yield* test.install(options({ namespace: "later", expectedOrigin: "not an origin" }))
      }))).pipe(Effect.exit)
      expect(yield* test.entries()).toEqual([])
      expect((yield* test.tools.snapshot()).codeModeCatalog?.tools ?? []).toEqual([])
      setupError(result)
    })),
  )

  it.effect("cleans up an activation batch when plugin setup fails after successful registrations", () =>
    provide(Effect.gen(function* () {
      const test = yield* fixture
      const failure = new OpenAPI.Error({ message: "Later plugin setup failed" })
      const result = yield* Effect.scoped(State.batch(Effect.gen(function* () {
        yield* test.install(options({ spec: document("first", "second") }))
        yield* test.install(options({ namespace: "later", spec: document("third") }))
        return yield* failure
      }))).pipe(Effect.exit)
      setupError(result)
      expect(yield* test.entries()).toEqual([])
      expect((yield* test.tools.snapshot()).codeModeCatalog?.tools ?? []).toEqual([])
    })),
  )

  it.effect("references an existing Integration only at invocation and never registers authentication", () =>
    provide(Effect.gen(function* () {
      const test = yield* fixture
      const integrationID = "existing-integration"
      yield* test.install(options({
        authentication: { type: "integration", integrationID, schemes: { api: { type: "apiKey" } } },
        spec: {
          ...document("ping"),
          security: [{ api: [] }],
          components: { securitySchemes: { api: { type: "apiKey", in: "header", name: "X-Key" } } },
        },
      }))
      expect(test.calls.active).toEqual([])
      expect(test.calls.integrationWrite).toBe(0)
      const entries = yield* test.entries()
      const entry = entries[0]
      expect(entry).toBeDefined()
      if (entry === undefined) return
      const context: Tool.Context = {
        caller: { type: "gateway", userID: User.ID.make("usr_registration") },
        id: Tool.CallID.make("registration-call"),
        elicit: () => Effect.die("unused"),
        permission: () => Effect.void,
        progress: () => Effect.void,
      }
      const error = yield* entry.execute({}, context).pipe(Effect.flip)
      expect(error).toBeInstanceOf(Tool.Error)
      expect(test.calls.active).toEqual([integrationID])
      expect(test.calls.credentialRead).toBe(0)
      expect(test.calls.integrationWrite).toBe(0)
      expect(test.calls.http).toBe(0)
    })),
  )
})
