import { describe, expect, it } from "@effect/vitest"
import { Agent } from "@bymorning/schema/agent"
import { ID as MessageID } from "@bymorning/schema/message"
import { Project } from "@bymorning/schema/project"
import { Session } from "@bymorning/schema/session"
import { Effect, Ref, Stream } from "effect"
import { CodeInterpreter } from "../src/code-interpreter.js"
import { ExecuteTool } from "../src/plugin/internal/tool/execute.js"
import { ProjectDirectory } from "../src/project-directory.js"
import { Tool } from "../src/tool.js"

// These are private implementation tests with explicit file/interpreter authorities.
// Registration/caller isolation is covered through real SessionTools in integration/session.test.ts.
describe("ExecuteTool private implementation", () => {
  it.effect("uses the explicitly supplied Project Directory for each leaf invocation", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<ReadonlyArray<CodeInterpreter.ExecuteInput>>([])
      const projectIDs = [
        Project.ID.make("prj_00000000000000000000000913"),
        Project.ID.make("prj_00000000000000000000000914"),
      ]
      const results = yield* Effect.forEach(
        projectIDs,
        (projectID) => {
          const code = `console.log(${JSON.stringify(projectID)})`
          return ExecuteTool.execute(
            { path: "script.ts" },
            {
              caller: {
                type: "session",
                sessionID: Session.ID.make(crypto.randomUUID()),
                agent: Agent.ID.make("build"),
                messageID: MessageID.make(crypto.randomUUID()),
                projectID,
              },
              id: Tool.CallID.make(`call_${projectID}`),
              progress: () => Effect.void,
              elicit: () => Effect.die("unused"),
              permission: (request) =>
                Effect.sync(() => {
                  expect(request.resources).toEqual([`project:${projectID}:script.ts`])
                }),
            },
          ).pipe(
            Effect.provideService(ProjectDirectory.Service, {
              projectID,
              list: Effect.succeed([ProjectDirectory.Path.make("script.ts")]),
              read: () =>
                Effect.succeed({
                  contentType: "text/typescript",
                  contentLength: code.length,
                  content: Stream.succeed(new TextEncoder().encode(code)),
                }),
              write: () => Effect.die("unused"),
              delete: () => Effect.die("unused"),
              move: () => Effect.die("unused"),
            }),
          )
        },
        { concurrency: "unbounded" },
      ).pipe(
        Effect.provideService(
          CodeInterpreter.Service,
          CodeInterpreter.fixed({
            execute: (input) =>
              Ref.update(seen, (values) => [...values, input]).pipe(Effect.as({ stdout: "", stderr: "", exitCode: 0 })),
          }),
        ),
      )
      expect(results).toHaveLength(2)
      expect(yield* Ref.get(seen)).toEqual(
        expect.arrayContaining(
          projectIDs.map((projectID) => expect.objectContaining({ code: `console.log(${JSON.stringify(projectID)})` })),
        ),
      )
    }),
  )

  it.effect("reads and executes an @-referenced Project source file", () =>
    Effect.gen(function* () {
      const requests = yield* Ref.make<ReadonlyArray<unknown>>([])
      const calls = yield* Ref.make<ReadonlyArray<CodeInterpreter.ExecuteInput>>([])
      const order = yield* Ref.make<ReadonlyArray<string>>([])
      const projectID = Project.ID.make("prj_00000000000000000000000911")
      const files = new Map([
        ["script.py", 'print("python")\n'],
        ["script.js", 'console.log("javascript")\n'],
        ["script.ts", 'console.log("typescript")\n'],
      ])
      const directory = ProjectDirectory.Service.of({
        projectID,
        list: Effect.succeed(Array.from(files.keys()).map((path) => ProjectDirectory.Path.make(path))),
        read: (path) => {
          const source = files.get(path)
          if (source === undefined) return Effect.die(`unexpected path: ${path}`)
          return Ref.update(order, (items) => [...items, `read:${path}`]).pipe(
            Effect.as({
              contentType: "text/plain",
              contentLength: source.length,
              content: Stream.succeed(new TextEncoder().encode(source)),
            }),
          )
        },
        write: () => Effect.die("unused"),
        delete: () => Effect.die("unused"),
        move: () => Effect.die("unused"),
      })
      const context: Tool.Context = {
        caller: {
          type: "session",
          sessionID: Session.ID.make("00000000-0000-4000-8000-000000000911"),
          agent: Agent.ID.make("build"),
          messageID: MessageID.make("00000000-0000-4000-8000-000000000912"),
          projectID,
        },
        id: Tool.CallID.make("call_run"),
        progress: () => Effect.void,
        elicit: () => Effect.die("unused"),
        permission: (request: Tool.PermissionRequest) =>
          Ref.update(requests, (items) => [...items, request]).pipe(
            Effect.andThen(Ref.update(order, (items) => [...items, `permission:${request.metadata?.path}`])),
          ),
      }

      for (const path of files.keys()) {
        expect(
          yield* ExecuteTool.execute({ path }, context).pipe(
            Effect.provideService(ProjectDirectory.Service, directory),
            Effect.provideService(
              CodeInterpreter.Service,
              CodeInterpreter.fixed({
                execute: (input) =>
                  Ref.update(calls, (items) => [...items, input]).pipe(
                    Effect.andThen(Ref.update(order, (items) => [...items, `interpreter:${path}`])),
                    Effect.as({
                      stdout: `${input.type === "code" ? input.language : "command"}\n`,
                      stderr: "",
                      exitCode: 0,
                    }),
                  ),
              }),
            ),
          ),
        ).toMatchObject({ output: { exitCode: 0 } })
      }

      expect(yield* Ref.get(calls)).toEqual([
        {
          type: "code",
          sessionName: "00000000-0000-4000-8000-000000000911",
          language: "python",
          code: files.get("script.py"),
        },
        {
          type: "code",
          sessionName: "00000000-0000-4000-8000-000000000911",
          language: "javascript",
          code: files.get("script.js"),
        },
        {
          type: "code",
          sessionName: "00000000-0000-4000-8000-000000000911",
          language: "typescript",
          code: files.get("script.ts"),
        },
      ])
      expect(yield* Ref.get(requests)).toEqual([
        {
          action: "execute",
          resources: ["project:prj_00000000000000000000000911:script.py"],
          save: ["project:prj_00000000000000000000000911:script.py"],
          metadata: { projectID, path: "script.py", language: "python" },
        },
        {
          action: "execute",
          resources: ["project:prj_00000000000000000000000911:script.js"],
          save: ["project:prj_00000000000000000000000911:script.js"],
          metadata: { projectID, path: "script.js", language: "javascript" },
        },
        {
          action: "execute",
          resources: ["project:prj_00000000000000000000000911:script.ts"],
          save: ["project:prj_00000000000000000000000911:script.ts"],
          metadata: { projectID, path: "script.ts", language: "typescript" },
        },
      ])
      expect(yield* Ref.get(order)).toEqual(
        Array.from(files.keys()).flatMap((path) => [`permission:${path}`, `read:${path}`, `interpreter:${path}`]),
      )
      expect(ExecuteTool.name).toBe("run")
      expect(ExecuteTool.description).toContain("@script.ts identifies script.ts; pass script.ts as path")
      expect(ExecuteTool.options).toEqual({ permission: "execute", codemode: false })
    }),
  )

  it.effect("explains execution failures without internal class names", () =>
    Effect.gen(function* () {
      const projectID = Project.ID.make("prj_00000000000000000000000911")
      const directory = ProjectDirectory.Service.of({
        projectID,
        list: Effect.succeed([]),
        read: () =>
          Effect.succeed({
            contentType: "text/plain",
            contentLength: 8,
            content: Stream.succeed(new TextEncoder().encode("print(1)")),
          }),
        write: () => Effect.die("unused"),
        delete: () => Effect.die("unused"),
        move: () => Effect.die("unused"),
      })
      const context: Tool.Context = {
        caller: {
          type: "session",
          sessionID: Session.ID.make("00000000-0000-4000-8000-000000000911"),
          agent: Agent.ID.make("build"),
          messageID: MessageID.make("00000000-0000-4000-8000-000000000912"),
          projectID,
        },
        id: Tool.CallID.make("call_run"),
        progress: () => Effect.void,
        elicit: () => Effect.die("unused"),
        permission: () => Effect.void,
      }
      const run = (interpreter: CodeInterpreter.Executor) =>
        ExecuteTool.execute({ path: "x.py" }, context).pipe(
          Effect.provideService(ProjectDirectory.Service, directory),
          Effect.provideService(CodeInterpreter.Service, CodeInterpreter.fixed(interpreter)),
          Effect.flip,
        )

      const failed = yield* run({
        execute: () => Effect.fail(new CodeInterpreter.ExecutionError({ operation: "invoke", message: "boom" })),
      })
      expect(failed.message).toBe("Unable to run x.py: boom")

      const unavailable = yield* ExecuteTool.execute({ path: "x.py" }, context).pipe(
        Effect.provideService(ProjectDirectory.Service, directory),
        Effect.provide(CodeInterpreter.unavailable),
        Effect.flip,
      )
      expect(unavailable.message).toBe("Code Interpreter is unavailable right now.")
    }),
  )
})
