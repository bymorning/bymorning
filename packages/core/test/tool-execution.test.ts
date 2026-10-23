import { layer as storageLayer } from "./fixture/storage.js"
import { describe, expect, it } from "@effect/vitest"
import { Agent } from "@bymorning/schema/agent"
import { ID as MessageID } from "@bymorning/schema/message"
import { Project } from "@bymorning/schema/project"
import { Session } from "@bymorning/schema/session"
import { Workspace } from "@bymorning/schema/workspace"
import { ToolCallPart } from "@opencode-ai/ai/schema/messages"
import { Effect, Layer, Ref, Schema, Stream } from "effect"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { CodeInterpreter } from "../src/code-interpreter.js"
import { PluginHooks } from "../src/plugin/hooks.js"
import { ProjectDirectory } from "../src/project-directory.js"
import { ProjectStorage } from "../src/project-storage.js"
import { Tool } from "../src/tool.js"

const execute = promisify(execFile)
const workspaceID = Workspace.ID.make("wrk_tool_execution")
const projectID = Project.ID.make("prj_00000000000000000000000901")
const sessionID = Session.ID.make("00000000-0000-4000-8000-000000000901")
const context = (permission: Tool.Context["permission"] = () => Effect.void): Tool.Context => ({
  caller: {
    type: "session",
    sessionID,
    agent: Agent.ID.make("build"),
    messageID: MessageID.make("00000000-0000-4000-8000-000000000902"),
    projectID,
  },
  id: Tool.CallID.make("call_sandbox"),
  progress: () => Effect.void,
  permission,
  elicit: () => Effect.die("unused"),
})
const run = (snapshot: Tool.Snapshot, name: string, input: unknown, ctx = context()) =>
  snapshot.execute({ call: ToolCallPart.make({ id: ctx.id, name, input }), context: ctx })
const dependencies = (interpreter: CodeInterpreter.Executor) =>
  Layer.mergeAll(storageLayer, PluginHooks.layer, Layer.succeed(CodeInterpreter.Service, CodeInterpreter.fixed(interpreter)))

describe("Tool sandbox execution", () => {
  it.effect("loads bound Project source independently of the calling Project Directory", () =>
    Effect.gen(function* () {
      const requests = yield* Ref.make<ReadonlyArray<Tool.PermissionRequest>>([])
      const calls = yield* Ref.make<ReadonlyArray<CodeInterpreter.ExecuteInput>>([])
      const order = yield* Ref.make<ReadonlyArray<string>>([])
      const path = ProjectDirectory.Path.make("scripts/echo.ts")
      const source = 'console.log("incidental");\nreturn { output: input.text, content: "handled" }'
      const adapters = dependencies({
        execute: (input) =>
          Effect.gen(function* () {
            yield* Ref.update(calls, (items) => [...items, input])
            yield* Ref.update(order, (items) => [...items, "interpreter"])
            if (input.type !== "code") return yield* Effect.die("expected code execution")
            const marker = input.code.match(/__BYMORNING_TOOL_RESULT_[^"]+__=/)?.[0]
            if (marker === undefined) return yield* Effect.die("missing result marker")
            return {
              stdout: `before\n${marker}${JSON.stringify({ output: "hello", content: "handled" })}\nafter\n`,
              stderr: "warning",
              exitCode: 0,
            }
          }),
      })
      yield* Effect.gen(function* () {
        const bound = yield* ProjectStorage.make(workspaceID, projectID)
        yield* bound.set(path.split("/"), {
          body: Stream.succeed(new TextEncoder().encode(source)),
          contentType: "text/typescript",
          contentLength: source.length,
        })
        const tools = yield* Tool.make
        yield* Tool.withSource(
          tools.transform((editor) =>
            editor.add({
              name: "echo",
              description: "echo",
              input: Schema.Struct({ text: Schema.String }),
              output: Schema.String,
              options: { permission: "canonical_echo", codemode: false },
              execution: "sandbox",
              implementation: { type: "project-file", path },
            }),
          ),
          { type: "project", projectID },
          workspaceID,
        )
        const snapshot = yield* tools.snapshot()
        for (const callerProjectID of [
          Project.ID.make("prj_00000000000000000000000902"),
          Project.ID.make("prj_00000000000000000000000903"),
        ]) {
          const ctx = context((request) =>
            Ref.update(requests, (items) => [...items, request]).pipe(
              Effect.andThen(Ref.update(order, (items) => [...items, "permission"])),
            ),
          )
          const result = yield* run(
            snapshot,
            "echo",
            { text: "hello" },
            {
              ...ctx,
              caller: { ...ctx.caller, projectID: callerProjectID },
            },
          ).pipe(
            Effect.provideService(ProjectDirectory.Service, {
              projectID: callerProjectID,
              list: Effect.die("caller directory must not be used"),
              read: () => Effect.die("caller directory must not be used"),
              write: () => Effect.die("unused"),
              delete: () => Effect.die("unused"),
              move: () => Effect.die("unused"),
            }),
          )
          expect(result).toEqual({
            output: "hello",
            content: [
              { type: "text", text: "handled" },
              { type: "text", text: "before\nafter\n" },
              { type: "text", text: "warning" },
            ],
          })
        }
        expect(yield* Ref.get(calls)).toEqual(
          Array.from({ length: 2 }, () =>
            expect.objectContaining({
              type: "code",
              language: "typescript",
              sessionName: sessionID,
              code: expect.stringContaining(source),
            }),
          ),
        )
        expect(yield* Ref.get(order)).toEqual(["permission", "interpreter", "permission", "interpreter"])
        expect(yield* Ref.get(requests)).toEqual(
          Array.from({ length: 2 }, () => ({
            action: "canonical_echo",
            resources: ["*"],
            save: ["*"],
            metadata: { tool: "echo", execution: "sandbox", implementation: "project-file", projectID, path },
          })),
        )
      }).pipe(Effect.provide(adapters))
    }),
  )

  it.effect("uses valid wrappers and safely embeds JSON in all pinned languages", () =>
    Effect.gen(function* () {
      const tools = yield* Tool.make
      for (const [language, body] of [
        ["python", 'print("incidental")\nreturn {"output": input["text"], "metadata": {"language": "python"}}'],
        [
          "javascript",
          'console.log("incidental"); return { output: input.text, metadata: { language: "javascript" } }',
        ],
        [
          "typescript",
          'console.log("incidental"); return { output: input.text, metadata: { language: "typescript" } }',
        ],
      ] as const) {
        const name = `inline_${language}`
        yield* tools.transform((editor) =>
          editor.add({
            name,
            description: language,
            input: Schema.Struct({ text: Schema.String }),
            output: Schema.String,
            options: { codemode: false },
            execution: "sandbox",
            implementation: { type: "inline", language, body },
          }),
        )
        const text = 'quotes " and \\ and newline\nplus unicode: cafe'
        expect(yield* run(yield* tools.snapshot(), name, { text })).toEqual({
          output: text,
          content: [{ type: "text", text: "incidental\n" }],
          metadata: { language },
        })
      }
    }).pipe(
      Effect.provide(
        dependencies({
          execute: (input) =>
            Effect.promise(async () => {
              if (input.type !== "code") throw new Error("expected code execution")
              const result = await execute(input.language === "python" ? "python3" : "bun", [
                input.language === "python" ? "-c" : "-e",
                input.code,
              ])
              return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 }
            }),
        }),
      ),
    ),
  )

  it.effect("prevents interpreter execution when the supplied permission callback fails", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const failure = new Tool.Error({ message: "sandbox denied" })
      yield* Effect.gen(function* () {
        const tools = yield* Tool.make
        yield* tools.transform((editor) =>
          editor.add({
            name: "sandboxed",
            description: "sandboxed",
            input: Schema.Struct({}),
            options: { codemode: false },
            execution: "sandbox",
            implementation: { type: "inline", language: "typescript", body: "return {}" },
          }),
        )
        const result = yield* run(
          yield* tools.snapshot(),
          "sandboxed",
          {},
          context(() => Effect.fail(failure)),
        ).pipe(Effect.flip)
        expect(result).toBe(failure)
        expect(yield* Ref.get(calls)).toBe(0)
      }).pipe(
        Effect.provide(
          dependencies({
            execute: () => Ref.update(calls, (count) => count + 1).pipe(Effect.andThen(Effect.die("called"))),
          }),
        ),
      )
    }),
  )
})
