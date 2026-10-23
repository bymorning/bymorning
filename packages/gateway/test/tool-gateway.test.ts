import { describe, expect, it } from "@effect/vitest"
import { Config } from "@bymorning/schema/config"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { NodeCrypto } from "@effect/platform-node"
import { Deferred, Effect, Fiber, Layer, Schema, Scope, Stream } from "effect"
import { Agent } from "@bymorning/core/agent"
import { Bus } from "@bymorning/core/bus"
import { CodeInterpreter } from "@bymorning/core/code-interpreter"
import { WorkspaceConfig } from "@bymorning/core/config"
import { Database } from "@bymorning/core/database"
import { Form } from "@bymorning/core/form"
import { Member as MCPGateway } from "../src/tool-gateway/member.js"
import { Plugin } from "@bymorning/core/plugin"
import { WorkspaceProject } from "@bymorning/core/project"
import { Reference } from "@bymorning/core/reference"
import { Skill } from "@bymorning/core/skill"
import { Tool } from "@bymorning/core/tool"
import { WebSearch } from "@bymorning/core/websearch"
import { layer as storageLayer } from "./fixture/storage.js"

const workspaceID = Workspace.ID.make("wrk_mcp_permissions")
const userID = User.ID.make("usr_mcp_gateway")

describe("MCPGateway", () => {
  it.effect("uses the member-bound registry and excludes built-ins", () =>
    withGateway(
      [{ action: "read", resource: "*", effect: "allow" }],
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        yield* Tool.withSource(
          tools.transform((editor) => {
            editor.add({
              name: "read",
              description: "Read",
              input: Schema.Struct({ value: Schema.String }),
              output: Schema.String,
              options: { codemode: false },
              execute: (input) => Effect.succeed({ output: input.value }),
            })
            editor.add({
              name: "builtin",
              description: "Builtin",
              input: Schema.Struct({}),
              execute: () => Effect.succeed({ output: "hidden" }),
            })
          }),
          { type: "sdk" },
          workspaceID,
        )
        const snapshot = yield* MCPGateway.Service.use((gateway) => gateway.snapshot)
        expect(snapshot.definitions.map((definition) => definition.name)).toEqual(["read", "execute"])
        const result = yield* snapshot.execute({
          call: { type: "tool-call", id: "call-1", name: "read", input: { value: "ok" } },
          context: context("call-1"),
          definitions: new Map(snapshot.definitions.map((definition) => [definition.name, definition])),
        })
        expect(result.output).toBe("ok")
      }),
    ),
  )

  it.effect("fails stale and denied calls before executing a leaf", () =>
    withGateway(
      [
        { action: "execute", resource: "*", effect: "allow" },
        { action: "blocked", resource: "*", effect: "deny" },
      ],
      Effect.gen(function* () {
        const calls = { count: 0 }
        const tools = yield* Tool.Service
        yield* Tool.withSource(
          tools.transform((editor) =>
            editor.add({
              name: "blocked",
              description: "Blocked",
              input: Schema.Struct({}),
              execute: () => Effect.sync(() => (calls.count++, { output: "called" })),
            }),
          ),
          { type: "sdk" },
          workspaceID,
        )
        const snapshot = yield* MCPGateway.Service.use((gateway) => gateway.snapshot)
        const result = yield* snapshot
          .execute({
            call: { type: "tool-call", id: "call-2", name: "blocked", input: {} },
            context: context("call-2"),
            definitions: new Map(),
          })
          .pipe(Effect.flip)
        expect(result.message).toContain("Unknown tool")
        expect(calls.count).toBe(0)
      }),
    ),
  )

  it.effect("preserves gateway hook input and settles it once", () =>
    withGateway(
      [{ action: "read", resource: "*", effect: "allow" }],
      Effect.gen(function* () {
        const events: string[] = []
        const hooks = yield* Plugin.Hooks.Service
        yield* hooks.register("gateway", "tool.execute.before", (event) =>
          Effect.sync(() => {
            event.input = { value: "changed" }
          }),
        )
        yield* hooks.register("gateway", "tool.execute.after", (event) =>
          Effect.sync(() => events.push(`${event.tool}:${event.status}`)),
        )
        const tools = yield* Tool.Service
        yield* Tool.withSource(
          tools.transform((editor) =>
            editor.add({
              name: "read",
              description: "Read",
              input: Schema.Struct({ value: Schema.String }),
              output: Schema.String,
              options: { codemode: false },
              execute: (input) => Effect.succeed({ output: input.value }),
            }),
          ),
          { type: "sdk" },
          workspaceID,
        )
        const snapshot = yield* MCPGateway.Service.use((gateway) => gateway.snapshot)
        const result = yield* snapshot.execute({
          call: { type: "tool-call", id: "call-3", name: "read", input: { value: "original" } },
          context: context("call-3"),
          definitions: new Map(snapshot.definitions.map((definition) => [definition.name, definition])),
        })
        expect(result.output).toBe("changed")
        expect(events).toEqual(["read:completed"])
      }),
    ),
  )

  it.effect("retains an eliciting call and resumes the original execution once", () =>
    withGateway(
      [{ action: "read", resource: "*", effect: "allow" }],
      Effect.gen(function* () {
        let executions = 0
        const tools = yield* Tool.Service
        yield* Tool.withSource(
          tools.transform((editor) =>
            editor.add({
              name: "confirm",
              description: "Confirm",
              input: Schema.Struct({}),
              output: Schema.Number,
              options: { codemode: false },
              execute: (_input, context) =>
                context
                  .elicit({
                    mode: "form",
                    title: "Confirm",
                    message: "Continue?",
                    fields: [{ key: "ok", type: "boolean", required: true }],
                  })
                  .pipe(Effect.map(() => ({ output: ++executions }))),
            }),
          ),
          { type: "sdk" },
          workspaceID,
        )
        const gateway = yield* MCPGateway.Service
        const pending = yield* gateway.call({ tool: "confirm", input: {}, capabilities: { form: true } })
        expect(pending.status).toBe("pending")
        if (pending.status !== "pending") return
        const completed = yield* gateway.resume({
          id: pending.id,
          response: { action: "accept", answer: { ok: true } },
        })
        expect(completed).toMatchObject({ status: "completed", result: { output: 1 } })
        const duplicate = yield* gateway.resume({
          id: pending.id,
          response: { action: "accept", answer: { ok: true } },
        })
        expect(duplicate).toEqual(completed)
        expect(executions).toBe(1)
      }),
    ),
  )

  it.effect("does not apply one response to a later elicitation round", () =>
    withGateway(
      [{ action: "read", resource: "*", effect: "allow" }],
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        yield* Tool.withSource(
          tools.transform((editor) =>
            editor.add({
              name: "twice",
              description: "Ask twice",
              input: Schema.Struct({}),
              output: Schema.String,
              options: { codemode: false },
              execute: (_input, context) =>
                context
                  .elicit({ mode: "form", title: "One", message: "One", fields: [{ key: "one", type: "boolean" }] })
                  .pipe(
                    Effect.andThen(
                      context.elicit({
                        mode: "form",
                        title: "Two",
                        message: "Two",
                        fields: [{ key: "two", type: "boolean" }],
                      }),
                    ),
                    Effect.as({ output: "done" }),
                  ),
            }),
          ),
          { type: "sdk" },
          workspaceID,
        )
        const gateway = yield* MCPGateway.Service
        const first = yield* gateway.call({ tool: "twice", input: {}, capabilities: { form: true } })
        if (first.status !== "pending") throw new Error("Expected first pending request")
        const second = yield* gateway.resume({
          id: first.id,
          round: first.round,
          response: { action: "accept", answer: {} },
        })
        expect(second).toMatchObject({ status: "pending", round: first.round + 1, request: { title: "Two" } })
        if (second.status !== "pending") throw new Error("Expected second pending request")
        expect(
          yield* gateway.resume({ id: second.id, round: second.round, response: { action: "accept", answer: {} } }),
        ).toMatchObject({ status: "completed", result: { output: "done" } })
      }),
    ),
  )

  it.effect("selects native per requested capability and honors only explicit presentation overrides", () =>
    withGateway(
      [{ action: "read", resource: "*", effect: "allow" }],
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        yield* Tool.withSource(
          tools.transform((editor) =>
            editor.add({
              name: "ask-form",
              description: "Ask",
              input: Schema.Struct({}),
              options: { codemode: false },
              execute: (_input, context) =>
                context
                  .elicit({ mode: "form", title: "Ask", message: "Ask", fields: [{ key: "ok", type: "boolean" }] })
                  .pipe(Effect.as({})),
            }),
          ),
          { type: "sdk" },
          workspaceID,
        )
        const gateway = yield* MCPGateway.Service
        expect((yield* gateway.call({ tool: "ask-form", input: {}, capabilities: { form: true } })).status).toBe(
          "pending",
        )
        const form = yield* gateway.call({ tool: "ask-form", input: {}, capabilities: { form: true } })
        expect(form).toMatchObject({ status: "pending", mode: "form" })
        if (form.status !== "pending") throw new Error("Expected pending")
        expect(
          yield* gateway
            .resume({ id: form.id, round: form.round, mode: "browser", response: { action: "accept", answer: {} } })
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "MCPGateway.RequestError" })
        const unsupported = yield* gateway.call({ tool: "ask-form", input: {}, capabilities: { url: true } })
        expect(unsupported).toMatchObject({ status: "pending", mode: "browser" })
        const model = yield* gateway.call({ tool: "ask-form", input: {}, mode: "model" })
        expect(model).toMatchObject({ status: "pending", mode: "model" })
      }),
    ),
  )

  it.effect("rejects invalid native answers without advancing the retained Tool", () =>
    withGateway(
      [{ action: "read", resource: "*", effect: "allow" }],
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        let calls = 0
        yield* Tool.withSource(
          tools.transform((editor) =>
            editor.add({
              name: "required",
              description: "Required",
              input: Schema.Struct({}),
              output: Schema.String,
              options: { codemode: false },
              execute: (_input, context) =>
                context
                  .elicit({
                    mode: "form",
                    title: "Required",
                    message: "Required",
                    fields: [{ key: "ok", type: "boolean", required: true }],
                  })
                  .pipe(Effect.map(() => ({ output: `${++calls}` }))),
            }),
          ),
          { type: "sdk" },
          workspaceID,
        )
        const gateway = yield* MCPGateway.Service
        const pending = yield* gateway.call({ tool: "required", input: {}, capabilities: { form: true } })
        if (pending.status !== "pending") throw new Error("Expected pending")
        expect(
          yield* gateway
            .resume({ id: pending.id, round: pending.round, response: { action: "accept", answer: {} } })
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "MCPGateway.RequestError" })
        expect(calls).toBe(0)
        expect(
          yield* gateway.resume({
            id: pending.id,
            round: pending.round,
            response: { action: "accept", answer: { ok: true } },
          }),
        ).toMatchObject({ status: "completed", result: { output: "1" } })
      }),
    ),
  )

  it.effect("does not hold the member lock while a browser continuation waits", () =>
    Effect.gen(function* () {
      const browserGate = yield* Deferred.make<Form.TerminalState>()
      const form = { ask: () => Deferred.await(browserGate) } as unknown as Form.Interface
      yield* withGateway(
        [{ action: "read", resource: "*", effect: "allow" }],
        Effect.gen(function* () {
          const tools = yield* Tool.Service
          yield* Tool.withSource(
            tools.transform((editor) => {
              for (const name of ["browser", "model"] as const)
                editor.add({
                  name,
                  description: name,
                  input: Schema.Struct({}),
                  output: Schema.String,
                  options: { codemode: false },
                  execute: (_input, context) =>
                    context
                      .elicit({ mode: "form", title: name, message: name, fields: [{ key: "ok", type: "boolean" }] })
                      .pipe(Effect.as({ output: name })),
                })
            }),
            { type: "sdk" },
            workspaceID,
          )
          const gateway = yield* MCPGateway.Service
          const browser = yield* gateway.call({ tool: "browser", input: {}, mode: "browser" })
          if (browser.status !== "pending") throw new Error("Expected browser pending")
          const waiting = yield* gateway
            .resume({ id: browser.id, round: browser.round, mode: "browser" })
            .pipe(Effect.forkScoped({ startImmediately: true }))

          const model = yield* gateway.call({ tool: "model", input: {}, mode: "model" })
          if (model.status !== "pending") throw new Error("Expected model pending")
          expect(
            yield* gateway.resume({
              id: model.id,
              round: model.round,
              response: { action: "accept", answer: { ok: true } },
            }),
          ).toMatchObject({ status: "completed", result: { output: "model" } })
          yield* Fiber.interrupt(waiting)
        }),
        form,
      )
    }),
  )

  it.effect("rechecks an admitted action after native approval", () => {
    const policy: { current: Config.Info["permissions"] } = {
      current: [{ action: "confirm", resource: "*", effect: "allow" }],
    }
    return withGateway(
      policy,
      Effect.gen(function* () {
        let sideEffects = 0
        const tools = yield* Tool.Service
        yield* Tool.withSource(
          tools.transform((editor) =>
            editor.add({
              name: "confirm",
              description: "Confirm",
              input: Schema.Struct({}),
              options: { codemode: false },
              execute: (_input, context) =>
                context
                  .permission({ action: "confirm", resources: ["*"] })
                  .pipe(
                    Effect.andThen(
                      context.elicit({
                        mode: "form",
                        title: "Confirm",
                        message: "Continue?",
                        fields: [{ key: "ok", type: "boolean" }],
                      }),
                    ),
                    Effect.andThen(Effect.sync(() => ({ output: ++sideEffects }))),
                  ),
            }),
          ),
          { type: "sdk" },
          workspaceID,
        )
        const gateway = yield* MCPGateway.Service

        const ask = yield* gateway.call({ tool: "confirm", input: {}, capabilities: { form: true } })
        if (ask.status !== "pending") throw new Error("Expected pending")
        policy.current = [{ action: "confirm", resource: "*", effect: "ask" }]
        expect(
          yield* gateway
            .resume({ id: ask.id, round: ask.round, response: { action: "accept", answer: { ok: true } } })
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "Tool.Error" })
        expect(sideEffects).toBe(0)

        policy.current = [{ action: "confirm", resource: "*", effect: "allow" }]
        const deny = yield* gateway.call({ tool: "confirm", input: {}, capabilities: { form: true } })
        if (deny.status !== "pending") throw new Error("Expected pending")
        policy.current = [{ action: "confirm", resource: "*", effect: "deny" }]
        expect(
          yield* gateway
            .resume({ id: deny.id, round: deny.round, response: { action: "accept", answer: { ok: true } } })
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "Tool.Error" })
        expect(sideEffects).toBe(0)
      }),
    )
  })
})

const context = (id: string): Tool.Context => ({
  caller: { type: "gateway", userID },
  id: id as Tool.CallID,
  progress: () => Effect.void,
  permission: () => Effect.void,
  elicit: () => Effect.fail(new Tool.Error({ message: "unused" })),
})

const withGateway = <A, E>(
  permissions: Config.Info["permissions"] | { current: Config.Info["permissions"] },
  effect: Effect.Effect<A, E, MCPGateway.Service | Tool.Service | Plugin.Hooks.Service | Scope.Scope>,
  form: Partial<Form.Interface> = {},
) => {
  const tool = Tool.layer.pipe(Layer.provide(Plugin.Hooks.layer))
  const dependencies = Layer.mergeAll(
    Plugin.Hooks.layer,
    tool,
    Layer.mock(WorkspaceConfig.Service, {
      provider: { update: () => Effect.die("unused") },
      model: { put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
      get: Effect.sync(() =>
        Config.Info.make({
          permissions: "current" in permissions ? permissions.current : permissions,
          compaction: { auto: true, buffer: 20_000, keep: { tokens: 15_000 } },
          model_policy: { disabled: [], seen: [], initialized: [] },
        }),
      ),
      modelPolicy: {
        reconcile: () => Effect.die("unused"),
        toggle: () => Effect.die("unused"),
        setDefault: () => Effect.die("unused"),
      },
      mcp: { update: () => Effect.die("unused"), put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
      plugin: WorkspaceConfig.pluginUnavailable,
      update: () => Effect.die("unused"),
      refresh: Effect.die("unused"),
      entries: () => Effect.succeed([]),
      changes: () => Stream.empty,
    }),
    Layer.mock(WorkspaceProject.Service, { list: () => Effect.succeed([]) }),
    Layer.mock(Bus.Service, {}),
    Layer.mock(Database.Service, {}),
    NodeCrypto.layer,
    CodeInterpreter.unavailable,
    storageLayer,
    Layer.mock(Agent.Service, {}),
    Layer.mock(Skill.Service, {}),
    Layer.mock(WebSearch.Service, {}),
    Layer.mock(Form.Service, form),
    Layer.succeed(
      Reference.Service,
      Reference.Service.of({
        list: () => Effect.succeed([]),
        transform: () => Effect.succeed({ dispose: Effect.void }),
        reload: () => Effect.void,
      }),
    ),
  )
  return Effect.scoped(effect).pipe(
    Effect.provide(MCPGateway.layer(workspaceID, userID).pipe(Layer.provideMerge(dependencies))),
  )
}
