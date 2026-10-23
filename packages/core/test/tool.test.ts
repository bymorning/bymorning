import { describe, expect, it } from "@effect/vitest"
import { Agent } from "@bymorning/schema/agent"
import { ID as MessageID } from "@bymorning/schema/message"
import { Project } from "@bymorning/schema/project"
import { ProjectDirectory } from "@bymorning/schema/project-directory"
import { Session } from "@bymorning/schema/session"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { ToolCallPart } from "@opencode-ai/ai/schema/messages"
import { Effect, Exit, Fiber, Layer, Schema, Scope } from "effect"
import { TestClock } from "effect/testing"
import { Tool } from "../src/tool.js"
import { PluginHooks } from "../src/plugin/hooks.js"
import { CodeInterpreter } from "../src/code-interpreter.js"
import { Storage } from "../src/storage.js"

const workspaceID = Workspace.ID.make("wrk_test")
const caller: Tool.Caller = {
  type: "session",
  sessionID: Session.ID.make("00000000-0000-4000-8000-000000000701"),
  messageID: MessageID.make("00000000-0000-4000-8000-000000000702"),
  agent: Agent.ID.make("build"),
  projectID: Project.ID.make("prj_00000000000000000000000721"),
}
const context = (type: "session" | "gateway" = "session"): Tool.Context => ({
  caller: type === "session" ? caller : { type: "gateway", userID: User.ID.make("usr_test") },
  id: Tool.CallID.make("call"),
  progress: () => Effect.void,
  elicit: () => Effect.die("unused"),
  permission: () => Effect.void,
})
const definition = (name: string, value = name, options: Tool.Options = { codemode: false }): Tool.Info => ({
  name,
  description: value,
  input: Schema.Struct({}),
  output: Schema.String,
  options,
  execute: () => Effect.succeed({ output: value }),
})
const run = (snapshot: Tool.Snapshot, name: string, input: unknown = {}, ctx = context()) =>
  snapshot.execute({ call: ToolCallPart.make({ id: ctx.id, name, input }), context: ctx })
const provide = <A, E>(effect: Effect.Effect<A, E, Tool.Service | PluginHooks.Service | Scope.Scope>) =>
  effect.pipe(
    Effect.scoped,
    Effect.provide(
      Layer.provideMerge(Tool.layer, Layer.mergeAll(PluginHooks.layer, CodeInterpreter.unavailable, storageLayer)),
    ),
  )
const storageLayer = Storage.layer({
  configure: (editor) => {
    const provider = Storage.memory()
    editor.add(provider)
    editor.default.set(provider.id)
  },
})

describe("Tool prepared snapshots", () => {
  it.effect("replays full editors, retains identity, skips invalid updates and disposes idempotently", () =>
    provide(
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        yield* tools.transform((editor) => editor.add(definition("demo.tool", "first")))
        const initial = yield* tools.snapshot()
        const registration = yield* tools.transform((editor) => {
          expect(editor.list().map((tool) => tool.id)).toEqual(["demo_tool"])
          editor.update("demo_tool", (tool) => {
            tool.name = "renamed"
            tool.options = { namespace: "other", codemode: false }
            tool.description = "updated"
            tool.execute = () => Effect.succeed({ output: "second" })
          })
          editor.update("demo_tool", (tool) => {
            tool.input = undefined as unknown as Tool.Info["input"]
          })
          editor.add(definition("", "invalid"))
        })
        expect((yield* tools.snapshot()).definitions[0]).toMatchObject({ name: "demo_tool", description: "updated" })
        expect((yield* run(initial, "demo_tool")).output).toBe("first")
        expect((yield* run(yield* tools.snapshot(), "demo_tool")).output).toBe("second")
        yield* registration.dispose
        yield* registration.dispose
        expect((yield* run(yield* tools.snapshot(), "demo_tool")).output).toBe("first")
      }),
    ),
  )

  it.effect("keeps last-valid normalized collisions and removes/reveals earlier definitions on scope close", () =>
    provide(
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        yield* tools.transform((editor) => {
          editor.add(definition("a.b", "first"))
          editor.add(definition("a_b", "last"))
          editor.add(definition("execute"))
          editor.add(definition("bad", "bad", { namespace: "bad namespace" }))
        })
        const scope = yield* Scope.make()
        yield* tools.transform((editor) => editor.remove("a_b")).pipe(Scope.provide(scope))
        expect((yield* tools.snapshot()).definitions.map((tool) => tool.name)).toEqual(["execute"])
        yield* Scope.close(scope, Exit.void)
        expect((yield* run(yield* tools.snapshot(), "a_b")).output).toBe("last")
      }),
    ),
  )

  it.effect("reloads registration callbacks without changing override precedence", () =>
    provide(
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        let value = "first"
        yield* tools.transform((editor) => editor.add(definition("changing", value)))
        const override = yield* tools.transform((editor) => editor.add(definition("changing", "override")))
        value = "refreshed"
        // State's reload is clock-debounced; test clock advances without real sleeps.
        const fiber = yield* tools.reload().pipe(Effect.forkChild)
        yield* TestClock.adjust("501 millis")
        yield* Fiber.join(fiber)
        expect((yield* run(yield* tools.snapshot(), "changing")).output).toBe("override")
        yield* override.dispose
        expect((yield* run(yield* tools.snapshot(), "changing")).output).toBe("refreshed")
      }),
    ),
  )

  it.effect("prepares direct and namespaced CodeMode identically for gateway; builtin winners never fall back", () =>
    provide(
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        yield* Tool.withSource(
          tools.transform((editor) => {
            editor.namespace({ name: "mail", description: "Mailbox" })
            editor.add(definition("read", "direct", { namespace: "mail", permission: "mail.read", codemode: false }))
            editor.add(definition("list", "nested", { namespace: "mail", permission: "mail.read", pinned: true }))
          }),
          { type: "sdk" },
          workspaceID,
        )
        const gateway = yield* tools.snapshot([], "gateway")
        expect(gateway.definitions.map((tool) => tool.name)).toEqual(["mail_read", "execute"])
        expect(gateway.codeModeCatalog).toMatchObject({
          tools: [{ type: "namespace", name: "mail", description: "Mailbox", tools: [{ name: "list", pinned: true }] }],
        })
        expect((yield* run(gateway, "mail_read", {}, context("gateway"))).output).toBe("direct")
        const result = yield* run(
          gateway,
          "execute",
          { description: "List mail", code: "return await tools.mail.list({})" },
          context("gateway"),
        )
        expect(result.output).toMatchObject({ output: "nested" })
        yield* tools.transform((editor) =>
          editor.add(definition("read", "builtin", { namespace: "mail", codemode: false })),
        )
        expect((yield* tools.snapshot([], "gateway")).definitions.map((tool) => tool.name)).toEqual(["execute"])
        expect((yield* run(gateway, "mail_read", {}, context("gateway"))).output).toBe("direct")
        expect(
          (yield* tools.snapshot([{ action: "execute", resource: "*", effect: "deny" }])).definitions.map(
            (tool) => tool.name,
          ),
        ).toEqual(["mail_read"])
      }),
    ),
  )

  it.effect("enforces declared outputs, typed failures, caller identity and leaf permissions", () =>
    provide(
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        yield* tools.transform((editor) => {
          editor.add({
            ...definition("raw"),
            output: { type: "string" },
            execute: () => Effect.succeed({ output: 42 }),
          })
          editor.add({ ...definition("missing"), execute: () => Effect.succeed({}) })
          editor.add({ ...definition("undeclared"), output: undefined })
          editor.add({
            ...definition("foreign"),
            execute: () => Effect.fail("foreign") as unknown as Effect.Effect<Tool.Result, Tool.Error>,
          })
          editor.add({
            ...definition("permission"),
            execute: (_, ctx) =>
              ctx.permission({ action: "sensitive", resources: ["exact"] }).pipe(Effect.as({ output: "ok" })),
          })
        })
        const snapshot = yield* tools.snapshot()
        for (const name of ["raw", "missing", "foreign"])
          expect((yield* run(snapshot, name).pipe(Effect.flip))._tag).toBe("Tool.Error")
        expect(Exit.isFailure(yield* run(snapshot, "undeclared").pipe(Effect.exit))).toBe(true)
        expect(
          (yield* run(
            snapshot,
            "permission",
            {},
            { ...context(), permission: () => Effect.fail(new Tool.Error({ message: "ask" })) },
          ).pipe(Effect.flip)).message,
        ).toBe("ask")
        expect((yield* run(snapshot, "permission", {}, context("gateway")).pipe(Effect.flip)).message).toContain(
          "caller mismatch",
        )
      }),
    ),
  )

  it.effect("preserves repaired names, surviving aliases and nested leaf hooks", () =>
    provide(
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        const hooks = yield* PluginHooks.Service
        const seen: string[] = []
        yield* hooks.register("tool", "execute.before", (event) =>
          Effect.sync(() => {
            seen.push(event.tool)
            if (event.tool === "repair") event.tool = "alias"
          }),
        )
        yield* tools.transform((editor) => {
          editor.add(definition("direct"))
          editor.add(definition("nested", "nested", {}))
        })
        const snapshot = yield* tools.snapshot()
        const direct = snapshot.definitions.find((tool) => tool.name === "direct")!
        const result = yield* snapshot.execute({
          call: ToolCallPart.make({ id: "call", name: "repair", input: {} }),
          context: context(),
          definitions: new Map([["alias", direct]]),
        })
        expect(result.output).toBe("direct")
        expect(
          (yield* snapshot
            .execute({
              call: ToolCallPart.make({ id: "call", name: "direct", input: {} }),
              context: context(),
              definitions: new Map(),
            })
            .pipe(Effect.flip)).message,
        ).toContain("not available")
        yield* run(snapshot, "execute", { description: "Call nested", code: "return await tools.nested({})" })
        expect(seen).toContain("nested")
      }),
    ),
  )

  it.effect("normalizes sandbox admission and uses actual gateway CallID after authorization", () =>
    provide(
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        const sessions: string[] = []
        const interpreter = CodeInterpreter.fixed({
          execute: (input) =>
            Effect.sync(() => {
              sessions.push(input.sessionName)
              const marker =
                input.type === "code" ? input.code.match(/__BYMORNING_TOOL_RESULT_[^_]+__=/)?.[0] : undefined
              return { stdout: `${marker}${JSON.stringify({ output: "sandbox" })}\n`, stderr: "" }
            }),
        })
        const sandboxTools = yield* Tool.make.pipe(
          Effect.provideService(CodeInterpreter.Service, interpreter),
          Effect.provide(storageLayer),
        )
        yield* Tool.withSource(
          sandboxTools.transform((editor) => {
            editor.add({
              name: "sandbox",
              description: "sandbox",
              input: Schema.Struct({}),
              output: Schema.String,
              options: { codemode: false },
              execution: "sandbox",
              implementation: { type: "inline", language: "typescript", body: 'return { output: "sandbox" }' },
            })
            editor.add({
              name: "unbound",
              description: "unbound",
              input: Schema.Struct({}),
              execution: "sandbox",
              implementation: { type: "project-file", path: ProjectDirectory.Path.make("tool.ts") },
            })
            expect(editor.list().find((tool) => tool.name === "sandbox")).not.toHaveProperty("implementation")
          }),
          { type: "sdk" },
          workspaceID,
        ).pipe(Effect.provideService(CodeInterpreter.Service, interpreter))
        const snapshot = yield* sandboxTools.snapshot([], "gateway")
        expect((yield* run(snapshot, "sandbox", {}, context("gateway"))).output).toBe("sandbox")
        expect(sessions).toEqual(["call"])
        yield* run(
          snapshot,
          "sandbox",
          {},
          { ...context("gateway"), permission: () => Effect.fail(new Tool.Error({ message: "denied" })) },
        ).pipe(Effect.flip)
        expect(sessions).toEqual(["call"])
      }),
    ),
  )
})
