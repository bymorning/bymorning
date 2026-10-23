import { describe, expect, it } from "@effect/vitest"
import { offlineAccount } from "./fixtures/offline-account.js"
import { Event } from "@bymorning/schema/outbound-mcp"
import { Agent } from "@bymorning/schema/agent"
import { ID as MessageID } from "@bymorning/schema/message"
import { Project } from "@bymorning/schema/project"
import { Session } from "@bymorning/schema/session"
import { User } from "@bymorning/schema/user"
import { Context, Deferred, Effect, Exit, Fiber, Layer, PubSub, Ref, Scope, Stream } from "effect"
import { Bus } from "../src/bus.js"
import { Credential } from "../src/credential.js"
import { Integration } from "../src/integration.js"
import { IntegrationOAuthCallback } from "../src/integration-oauth-callback.js"
import { Mcp } from "../src/mcp.js"
import * as McpClient from "../src/mcp/client.js"
import { PluginHooks } from "../src/plugin/hooks.js"
import { Tool } from "../src/tool.js"
import { McpTool } from "../src/tool/mcp.js"
import { State } from "../src/state.js"
import { server, type ToolDefinition } from "./mcp/transport.js"

const testEffect = (name: string, effect: () => Effect.Effect<void, unknown, Scope.Scope>) =>
  it(name, () => Effect.runPromise(Effect.scoped(Effect.suspend(effect))))

describe("Mcp transport", () => {
  testEffect("prefers raw upstream tools only for local Code Mode and preserves explicit query choices", () =>
    Effect.gen(function* () {
      for (const [query, codemode, expected] of [
        ["?source=bm", undefined, "false"],
        ["?source=bm", false, null],
        ["?source=bm&codemode=true", undefined, "true"],
        ["?source=bm&codemode=false", false, "false"],
      ] as const) {
        const fixture = yield* server(tool())
        const url = `${fixture.url}${query}`
        const identity = Mcp.identity("remote", url)
        const harness = yield* make()
        yield* harness.mcp.transform((editor) => editor.set("remote", {
          type: "remote", url, ...(codemode === undefined ? {} : { codemode }),
        }))
        const initialize = new URL(fixture.requests[0]!.url, fixture.url)
        expect(initialize.searchParams.get("codemode")).toBe(expected)
        expect(initialize.searchParams.get("source")).toBe("bm")
        expect(yield* harness.mcp.servers()).toMatchObject([{ name: "remote", url, status: "connected", integrationID: identity }])
      }
    }),
  )

  testEffect("retries the original configured URL once only when the added Code Mode query gets a 404", () =>
    Effect.gen(function* () {
      const fixture = yield* server(tool(), { reject: (url) => url.searchParams.has("codemode") ? 404 : undefined })
      const client = yield* McpClient.connect("remote", config(`${fixture.url}?source=bm`))
      expect((yield* client.tools()).map((tool) => tool.name)).toEqual(["answer"])
      expect(fixture.requests.filter((request) => request.method === "POST").slice(0, 2).map((request) => request.url))
        .toEqual(["/mcp?source=bm&codemode=false", "/mcp?source=bm"])
      expect(fixture.connections).toBe(1)

      for (const [status, query, count] of [[500, "", 1], [404, "?codemode=true", 1], [404, "", 2]] as const) {
        const rejected = yield* server(tool(), { reject: () => status })
        expect(Exit.isFailure(yield* McpClient.connect("remote", config(`${rejected.url}${query}`)).pipe(Effect.exit))).toBe(true)
        expect(rejected.requests).toHaveLength(count)
      }
    }),
  )

  testEffect("preserves remote media and embedded resources through real Session and gateway snapshots with caller metadata", () =>
    Effect.gen(function* () {
      const fixture = yield* server(tool(), { result: {
        structuredContent: { answer: 42 },
        content: [
          { type: "text", text: "answer" },
          { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
          { type: "audio", mimeType: "audio/wav", data: "YXVkaW8=" },
          { type: "resource", resource: { uri: "file:///answer.txt", mimeType: "text/plain", text: "embedded answer" } },
          { type: "resource", resource: { uri: "file:///answer.pdf", mimeType: "application/pdf", blob: "YmxvYg==" } },
          { type: "resource", resource: { uri: "file:///unknown", blob: "YmxvYg==" } },
          { type: "resource_link", uri: "https://example.test/answer", name: "answer" },
        ],
      } })
      const harness = yield* make()
      yield* harness.mcp.transform((editor) => editor.set("remote", { ...config(fixture.url), codemode: false }))
      yield* adapter(harness)
      for (const audience of ["session", "gateway"] as const) {
        const snapshot = yield* harness.tools.snapshot([], audience)
        expect(snapshot.definitions.find((tool) => tool.name === "remote_answer")?.outputSchema).toEqual({ type: "object" })
        const result = yield* invoke(snapshot, audience)
        expect(result.output).toEqual({ answer: 42 })
        expect(result.content).toEqual([
          { type: "text", text: "answer" },
          { type: "file", mime: "image/png", uri: "data:image/png;base64,aGVsbG8=" },
          { type: "file", mime: "audio/wav", uri: "data:audio/wav;base64,YXVkaW8=" },
          { type: "text", text: "embedded answer" },
          { type: "file", mime: "application/pdf", uri: "data:application/pdf;base64,YmxvYg==" },
          { type: "file", mime: "application/octet-stream", uri: "data:application/octet-stream;base64,YmxvYg==" },
          { type: "text", text: "https://example.test/answer" },
        ])
      }
      expect(fixture.invocations[0]?._meta).toEqual({ sessionID })
      expect(fixture.invocations[1]?._meta).toBeUndefined()
    }),
  )

  testEffect("removes a broken remote connection and reconnects without stale-stream interference", () =>
    Effect.gen(function* () {
      const fixture = yield* server(tool())
      const harness = yield* make()
      yield* harness.mcp.transform((editor) => editor.set("remote", { ...config(fixture.url), codemode: false }))
      let admitted = yield* Deferred.make<void>()
      yield* adapter({ ...harness, tools: {
        ...harness.tools,
        reload: () => harness.tools.reload().pipe(Effect.andThen(Deferred.succeed(admitted, undefined))),
      } })
      const captured = yield* harness.tools.snapshot()
      yield* Effect.promise(() => fixture.waitForSSE(0))
      fixture.destroySSE(0)
      yield* Deferred.await(admitted)
      expect(yield* harness.mcp.servers()).toMatchObject([{ name: "remote", status: "failed" }])
      expect(yield* harness.mcp.tools()).toEqual([])
      expect((yield* harness.tools.snapshot()).definitions.map((tool) => tool.name)).toEqual(["execute"])
      expect(Exit.isFailure(yield* invoke(captured).pipe(Effect.exit))).toBe(true)

      admitted = yield* Deferred.make<void>()
      yield* harness.mcp.connect("remote")
      yield* Deferred.await(admitted)
      yield* Effect.promise(() => fixture.waitForSSE(1))
      fixture.destroySSE(0)
      // A real request through the captured definition proves that execution
      // resolves the new connection, not the retired transport.
      expect((yield* invoke(captured)).output).toEqual({ answer: 42 })
      expect(yield* harness.mcp.servers()).toMatchObject([{ name: "remote", status: "connected" }])
    }),
  )

  testEffect("admits omitted MCP output schemas without relaxing declared schema mismatches", () =>
    Effect.gen(function* () {
      const omitted = yield* server({ name: "answer", description: "Answers", inputSchema: { type: "object", properties: {} } })
      const harness = yield* make()
      yield* harness.mcp.transform((editor) => editor.set("remote", { ...config(omitted.url), codemode: false }))
      yield* adapter(harness)
      const snapshot = yield* harness.tools.snapshot()
      expect(snapshot.definitions.find((tool) => tool.name === "remote_answer")?.outputSchema).toEqual({})
      expect((yield* invoke(snapshot)).output).toEqual({ answer: 42 })

      const mismatch = yield* server({
        ...tool(),
        outputSchema: { type: "object", properties: { answer: { type: "number" } }, required: ["answer"] },
      }, { result: { structuredContent: { answer: "not a number" }, content: [{ type: "text", text: "wrong" }] } })
      // A fresh public composition captures the newly advertised schema.
      const fresh = yield* make()
      yield* fresh.mcp.transform((editor) => editor.set("remote", { ...config(mismatch.url), codemode: false }))
      yield* adapter(fresh)
      const invalid = yield* fresh.tools.snapshot()
      expect((yield* invoke(invalid).pipe(Effect.flip))._tag).toBe("Tool.Error")
    }),
  )

  testEffect("bounds and aborts a hanging session DELETE when the client scope closes", () =>
    Effect.gen(function* () {
      const fixture = yield* server(tool(), { hangDelete: true })
      const scope = yield* Scope.fork(yield* Scope.Scope)
      yield* McpClient.connect("remote", config(fixture.url)).pipe(Scope.provide(scope))
      const closing = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild)
      yield* Effect.promise(() => fixture.deleteStarted)
      yield* Fiber.join(closing).pipe(Effect.timeout("2 seconds"))
      yield* Effect.promise(() => fixture.deleteClosed)
      fixture.releaseDelete()
      expect(fixture.closes).toBe(0)
    }),
  )

  testEffect("coalesces activation edits at the State batch boundary without connecting overridden configurations", () =>
    Effect.gen(function* () {
      const first = yield* server({ ...tool(), name: "first" })
      const second = yield* server({ ...tool(), name: "second" })
      const harness = yield* make()
      const registrations = yield* State.batch(Effect.gen(function* () {
        const left = yield* harness.mcp.transform((editor) => editor.set("remote", config(first.url)))
        const right = yield* harness.mcp.transform((editor) => editor.set("remote", config(second.url)))
        expect(first.connections).toBe(0)
        expect(second.connections).toBe(0)
        return { left, right }
      }))
      expect(first.connections).toBe(0)
      expect((yield* harness.mcp.tools()).map((tool) => tool.name)).toEqual(["second"])
      yield* State.batch(Effect.gen(function* () {
        yield* registrations.right.dispose
        yield* registrations.left.dispose
      }))
      expect(first.connections).toBe(0)
      expect(yield* harness.mcp.tools()).toEqual([])
    }),
  )

  testEffect("cancels in-flight public discovery when the owning MCP scope closes", () =>
    Effect.gen(function* () {
      const started = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const fixture = yield* server(tool(), { list: () => { started.resolve(); return release.promise } })
      const scope = yield* Scope.fork(yield* Scope.Scope)
      const harness = yield* make().pipe(Scope.provide(scope))
      const registration = yield* harness.mcp.transform((editor) => editor.set("remote", config(fixture.url))).pipe(Effect.forkChild)
      yield* Effect.promise(() => started.promise)
      yield* Scope.close(scope, Exit.void)
      yield* Fiber.join(registration)
      release.resolve()
      expect(yield* harness.mcp.tools()).toEqual([])
      expect(fixture.closes).toBe(1)
    }),
  )

  testEffect("discovers, invokes, and exposes a real server through Tool", () =>
    Effect.gen(function* () {
      const fixture = yield* server(tool())
      const harness = yield* make()
      yield* harness.mcp.transform((editor) => editor.set("remote", { ...config(fixture.url), codemode: false }))
      const adapter = yield* Layer.build(McpTool.layer(harness.tools).pipe(Layer.provideMerge(Layer.mergeAll(
        Layer.succeed(Mcp.Service, harness.mcp), Layer.succeed(Bus.Service, harness.bus),
      ))))
      yield* Context.get(adapter, McpTool.Service).flush

      expect(yield* harness.mcp.tools()).toMatchObject([{ server: "remote", name: "answer", description: "Answers", outputSchema: { type: "object" } }])
      const snapshot = yield* harness.tools.snapshot()
      expect(snapshot.definitions.find((definition) => definition.name === "remote_answer")).toMatchObject({
        description: "Answers",
        outputSchema: { type: "object" },
      })
      const result = yield* harness.mcp.callTool({ server: "remote", name: "answer" })
      expect(result).toEqual({
        isError: false,
        structured: { answer: 42 },
        content: [
          { type: "text", text: "answer" },
          { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
          { type: "resource", uri: "file:///answer.txt", mimeType: "text/plain", text: "answer" },
        ],
      })
      expect(fixture.calls).toBe(1)
    }),
  )

  testEffect("replaces schema and description without changing names and publishes ToolsChanged", () =>
    Effect.gen(function* () {
      const first = yield* server(tool())
      const second = yield* server({ name: "answer", description: "New answer", inputSchema: { type: "object", properties: { question: { type: "string" } } }, outputSchema: { type: "object", properties: { answer: { type: "number" } } } })
      const harness = yield* make()
      yield* harness.mcp.transform((editor) => editor.set("remote", config(first.url)))
      const before = (yield* Ref.get(harness.events)).length
      yield* harness.mcp.transform((editor) => editor.set("remote", config(second.url)))
      expect((yield* Ref.get(harness.events)).slice(before)).toContain(Event.ToolsChanged)
      expect(yield* harness.mcp.tools()).toEqual([{ server: "remote", name: "answer", action: "remote_answer", description: "New answer", inputSchema: { type: "object", properties: { question: { type: "string" } } }, outputSchema: { type: "object", properties: { answer: { type: "number" } } }, codemode: true }])
    }),
  )

  testEffect("refreshes same-name schemas from a real tools/list_changed notification", () =>
    Effect.gen(function* () {
      const fixture = yield* server(tool())
      const harness = yield* make()
      yield* harness.mcp.transform((editor) => editor.set("remote", { ...config(fixture.url), codemode: false }))
      const refreshed = yield* Deferred.make<void>()
      const toolService: Tool.Interface = {
        ...harness.tools,
        reload: () => harness.tools.reload().pipe(Effect.tap(() => Deferred.succeed(refreshed, undefined))),
      }
      const adapter = yield* Layer.build(McpTool.layer(toolService).pipe(Layer.provide(Layer.mergeAll(
        Layer.succeed(Mcp.Service, harness.mcp), Layer.succeed(Bus.Service, harness.bus),
      ))))
      yield* Context.get(adapter, McpTool.Service).flush
      const changed = yield* (yield* harness.bus.subscribe(Event.ToolsChanged)).pipe(Stream.runHead, Effect.forkChild({ startImmediately: true }))
      yield* Effect.promise(() => fixture.update({ ...tool(), description: "Refreshed", inputSchema: { type: "object", properties: { query: { type: "string" } } } }))
      yield* Fiber.join(changed)
      yield* Deferred.await(refreshed)
      expect(yield* harness.mcp.tools()).toMatchObject([{ name: "answer", description: "Refreshed", inputSchema: { properties: { query: { type: "string" } } } }])
      // Inspect the actual direct definition, not a replacement catalog double.
      const snapshot = yield* harness.tools.snapshot()
      expect(snapshot.definitions.find((tool) => tool.name === "remote_answer")).toMatchObject({ description: "Refreshed", inputSchema: { properties: { query: { type: "string" } } } })
      expect(fixture.connections).toBe(1)
    }),
  )

  testEffect("uses the most recent transform and restores the prior transform when disposed", () =>
    Effect.gen(function* () {
      const first = yield* server({ ...tool(), name: "first" })
      const second = yield* server({ ...tool(), name: "second" })
      const harness = yield* make()
      const left = yield* harness.mcp.transform((editor) => editor.set("remote", config(first.url)))
      const right = yield* harness.mcp.transform((editor) => editor.set("remote", config(second.url)))
      expect((yield* harness.mcp.tools()).map((value) => value.name)).toEqual(["second"])
      yield* right.dispose
      expect((yield* harness.mcp.tools()).map((value) => value.name)).toEqual(["first"])
      yield* left.dispose
      expect(yield* harness.mcp.tools()).toEqual([])
    }),
  )

  testEffect("disconnects, closes, and rejects calls after the server is removed", () =>
    Effect.gen(function* () {
      const fixture = yield* server(tool())
      const harness = yield* make()
      const registration = yield* harness.mcp.transform((editor) => editor.set("remote", config(fixture.url)))
      yield* harness.mcp.disconnect("remote")
      expect(yield* harness.mcp.servers()).toMatchObject([{ name: "remote", status: "disabled" }])
      yield* harness.mcp.connect("remote")
      yield* registration.dispose
      expect(Exit.isFailure(yield* harness.mcp.callTool({ server: "remote", name: "answer" }).pipe(Effect.exit))).toBe(true)
      expect(fixture.closes).toBeGreaterThan(0)
    }),
  )

  testEffect("does not let runtime operations bypass a disabled server", () =>
    Effect.gen(function* () {
      const fixture = yield* server(tool())
      const harness = yield* make()
      yield* harness.mcp.transform((editor) =>
        editor.set("remote", { ...config(fixture.url), enabled: false }),
      )

      expect(yield* harness.mcp.servers()).toMatchObject([
        { name: "remote", enabled: false, status: "disabled" },
      ])
      expect(Exit.isFailure(yield* harness.mcp.connect("remote").pipe(Effect.exit))).toBe(true)
      expect(Exit.isFailure(yield* harness.mcp.test("remote").pipe(Effect.exit))).toBe(true)
      expect(yield* harness.mcp.tools()).toEqual([])
    }),
  )
})

const tool = (): ToolDefinition => ({ name: "answer", description: "Answers", inputSchema: { type: "object", properties: {} }, outputSchema: { type: "object" } })
const config = (url: string) => ({ type: "remote" as const, url, oauth: false as const })

const sessionID = Session.ID.make("00000000-0000-4000-8000-000000000701")
const invoke = (snapshot: Tool.Snapshot, audience: "session" | "gateway" = "session") => {
  const id = Tool.CallID.make("call_remote")
  return snapshot.execute({
    call: { type: "tool-call", id, name: "remote_answer", input: {} },
    context: {
      id,
      caller: audience === "gateway" ? { type: "gateway", userID: User.ID.make("usr_remote") } : {
        type: "session", sessionID, messageID: MessageID.make("00000000-0000-4000-8000-000000000702"),
        agent: Agent.ID.make("build"), projectID: Project.ID.make("prj_00000000000000000000000721"),
      },
      elicit: () => Effect.die("unused"),
      permission: () => Effect.void,
      progress: () => Effect.void,
    },
  })
}

const adapter = (harness: { mcp: Mcp.Interface; tools: Tool.Interface; bus: Bus.Interface }) =>
  Layer.build(Tool.discovery.pipe(Layer.provide(Layer.mergeAll(
    Layer.succeed(Mcp.Service, harness.mcp), Layer.succeed(Tool.Service, harness.tools), Layer.succeed(Bus.Service, harness.bus),
  )))).pipe(Effect.asVoid)

const make = () => Effect.gen(function* () {
  const hooks = Context.get(yield* Layer.build(PluginHooks.layer), PluginHooks.Service)
  const tools = yield* Tool.make.pipe(Effect.provideService(PluginHooks.Service, hooks))
  const events = yield* Ref.make<unknown[]>([])
  const changes = yield* PubSub.unbounded<unknown>()
  const bus = {
    publish: (definition: unknown, _data: unknown) => Ref.update(events, (published) => [...published, definition]).pipe(Effect.andThen(PubSub.publish(changes, definition))),
    subscribe: (definition: unknown) => PubSub.subscribe(changes).pipe(
      Effect.map((subscription) =>
        Stream.fromSubscription(subscription).pipe(Stream.filter((event) => event === definition), Stream.map(() => ({ data: {} }))),
      ),
    ),
  } as unknown as Bus.Interface
  const integration = {
    transform: (update: (editor: { get: (id: unknown) => undefined; update: (id: unknown, edit: (value: { name: string }) => void) => void; method: { update: () => void } }) => void) =>
      Effect.gen(function* () {
        update({ get: () => undefined, update: (_id, edit) => edit({ name: "" }), method: { update: () => {} } })
        let active = true
        const dispose = Effect.sync(() => { active = false })
        yield* Scope.addFinalizer(yield* Scope.Scope, dispose)
        return { dispose: Effect.suspend(() => active ? dispose : Effect.void) }
      }),
    connection: { active: () => Effect.void, resolve: () => Effect.void },
  } as unknown as Integration.Interface
  const credential = {} as Credential.Interface
  const oauthCallback = {} as IntegrationOAuthCallback.Interface
  const mcp = yield* Mcp.make({ account: offlineAccount(), integration, credential, oauthCallback, owner: {} as IntegrationOAuthCallback.Owner, bus })
  return { mcp, tools, bus, events }
})
