import { describe, expect, it } from "@effect/vitest"
import { Agent } from "@bymorning/schema/agent"
import { ID as MessageID } from "@bymorning/schema/message"
import { Session, type SyntheticInput } from "@bymorning/schema/session"
import { Project } from "@bymorning/schema/project"
import { Deferred, Effect, Fiber, Layer, Ref, Scope } from "effect"
import { Agent as AgentService } from "../src/agent.js"
import { CodeInterpreter } from "../src/code-interpreter.js"
import { Job } from "../src/job.js"
import { makeShellTool } from "../src/plugin/internal/tool/shell.js"
import { Tool } from "../src/tool.js"

const sessionID = Session.ID.make("00000000-0000-4000-8000-000000000801")

describe("ShellTool", () => {
  it.effect("checks permission and preserves foreground command output", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const permissions = yield* Ref.make<ReadonlyArray<unknown>>([])
        const jobs = yield* Job.make
        const scope = yield* Scope.Scope
        const tool = makeShellTool({ job: jobs, session: { synthetic: () => Effect.void } }, scope, new Set())
        const result = yield* execute(tool, { command: "pwd && echo hello" }, permissions, {
          execute: (input) =>
            Effect.sync(() => {
              expect(input).toEqual({ type: "command", sessionName: sessionID, command: "pwd && echo hello" })
              return { stdout: "/workspace\nhello\n", stderr: "", exitCode: 0 }
            }),
        })

        expect(result).toEqual({
          output: { stdout: "/workspace\nhello\n", stderr: "", exitCode: 0 },
          content: [{ type: "text", text: "/workspace\nhello\n" }],
          metadata: expect.objectContaining({ source: "shell", shellID: "call_shell", status: "completed" }),
        })
        expect(yield* Ref.get(permissions)).toEqual([
          {
            action: "shell",
            resources: ["pwd && echo hello"],
            save: ["*"],
            metadata: { command: "pwd && echo hello" },
          },
        ])
      }),
    ),
  )

  it.effect("returns immediately in explicit background and notifies once", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const command = yield* Deferred.make<void>()
        const notified = yield* Deferred.make<SyntheticInput>()
        const jobs = yield* Job.make
        const scope = yield* Scope.Scope
        const tool = makeShellTool(
          {
            job: jobs,
            session: { synthetic: (input) => Deferred.succeed(notified, input).pipe(Effect.asVoid) },
          },
          scope,
          new Set(),
        )
        const permissions = yield* Ref.make<ReadonlyArray<unknown>>([])
        const result = yield* execute(tool, { command: "echo later", background: true }, permissions, {
          execute: () => Deferred.await(command).pipe(Effect.as({ stdout: "later\n", stderr: "", exitCode: 0 })),
        })
        expect(result.output).toEqual({ status: "running", shellID: "call_shell" })
        yield* Deferred.succeed(command, undefined)
        const synthetic = yield* Deferred.await(notified)
        expect(synthetic.metadata).toMatchObject({ source: "shell", shellID: "call_shell", state: "completed" })
      }),
    ),
  )

  it.effect("external background releases the blocker without cancelling the command", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const command = yield* Deferred.make<void>()
        const notified = yield* Deferred.make<void>()
        const started = yield* Deferred.make<void>()
        const progressed = yield* Deferred.make<void>()
        const jobs = yield* Job.make
        const scope = yield* Scope.Scope
        const tool = makeShellTool(
          {
            job: jobs,
            session: { synthetic: () => Deferred.succeed(notified, undefined).pipe(Effect.asVoid) },
          },
          scope,
          new Set(),
        )
        const permissions = yield* Ref.make<ReadonlyArray<unknown>>([])
        const fiber = yield* execute(
          tool,
          { command: "echo later" },
          permissions,
          {
            execute: () =>
              Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Deferred.await(command)),
                Effect.as({ stdout: "later\n", stderr: "", exitCode: 0 }),
              ),
          },
          () => Deferred.succeed(progressed, undefined).pipe(Effect.asVoid),
        ).pipe(Effect.forkChild)
        yield* Deferred.await(started)
        yield* Deferred.await(progressed)
        yield* Effect.yieldNow
        expect(yield* jobs.backgroundAll({ sessionID })).toHaveLength(1)
        expect((yield* Fiber.join(fiber)).output).toEqual({ status: "running", shellID: "call_shell" })
        yield* Deferred.succeed(command, undefined)
        yield* Deferred.await(notified)
      }),
    ),
  )

  it.effect("foreground interruption cancels the Job and underlying command authority", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const finalized = yield* Deferred.make<void>()
        const progressed = yield* Deferred.make<void>()
        const jobs = yield* Job.make
        const scope = yield* Scope.Scope
        const tool = makeShellTool({ job: jobs, session: { synthetic: () => Effect.void } }, scope, new Set())
        const permissions = yield* Ref.make<ReadonlyArray<unknown>>([])
        const fiber = yield* execute(
          tool,
          { command: "long command" },
          permissions,
          {
            execute: () =>
              Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(Deferred.succeed(finalized, undefined)),
              ),
          },
          () => Deferred.succeed(progressed, undefined).pipe(Effect.asVoid),
        ).pipe(Effect.forkChild)
        yield* Deferred.await(started)
        yield* Deferred.await(progressed)
        yield* Effect.yieldNow
        yield* Fiber.interrupt(fiber)
        yield* Deferred.await(finalized)
        expect(yield* jobs.get("call_shell")).toMatchObject({ status: "cancelled" })
      }),
    ),
  )

  it.effect("never ends a foreground failure with an empty reason", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const jobs = yield* Job.make
        const scope = yield* Scope.Scope
        const tool = makeShellTool({ job: jobs, session: { synthetic: () => Effect.void } }, scope, new Set())
        const permissions = yield* Ref.make<ReadonlyArray<unknown>>([])
        const error = yield* execute(tool, { command: "boom" }, permissions, {
          execute: () => Effect.fail(new CodeInterpreter.ExecutionError({ operation: "invoke", message: "" })),
        }).pipe(Effect.flip)
        expect(error.message).toMatch(/^Shell failed: \S.*[^:\s]$/)
      }),
    ),
  )

  it.effect("reports an unavailable Code Interpreter without internal names or call IDs", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const jobs = yield* Job.make
        const scope = yield* Scope.Scope
        const tool = makeShellTool({ job: jobs, session: { synthetic: () => Effect.void } }, scope, new Set())
        const error = yield* tool
          .execute(
            { command: "ls" },
            {
              caller: {
                type: "session",
                projectID: Project.ID.make("prj_00000000000000000000000801"),
                sessionID,
                agent: Agent.ID.make("build"),
                messageID: MessageID.make("00000000-0000-4000-8000-000000000802"),
              },
              id: Tool.CallID.make("call_shell"),
              progress: () => Effect.void,
              elicit: () => Effect.die("unused"),
              permission: () => Effect.void,
            },
          )
          .pipe(Effect.provide(CodeInterpreter.unavailable), Effect.flip)
        expect(error.message).toBe("Shell failed: Code Interpreter is unavailable right now.")
      }),
    ),
  )

  it.effect("emits a terminal error synthetic for background failure", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const notified = yield* Deferred.make<SyntheticInput>()
        const jobs = yield* Job.make
        const scope = yield* Scope.Scope
        const tool = makeShellTool(
          {
            job: jobs,
            session: { synthetic: (input) => Deferred.succeed(notified, input).pipe(Effect.asVoid) },
          },
          scope,
          new Set(),
        )
        const permissions = yield* Ref.make<ReadonlyArray<unknown>>([])
        const result = yield* execute(tool, { command: "fail", background: true }, permissions, {
          execute: () =>
            Effect.fail(new CodeInterpreter.ExecutionError({ operation: "invoke", message: "command failed" })),
        })

        expect(result.output).toEqual({ status: "running", shellID: "call_shell" })
        expect((yield* Deferred.await(notified)).metadata).toMatchObject({
          source: "shell",
          shellID: "call_shell",
          state: "error",
          error: "command failed",
        })
      }),
    ),
  )

  it.effect("emits a terminal cancellation synthetic for background cancellation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const notified = yield* Deferred.make<SyntheticInput>()
        const jobs = yield* Job.make
        const scope = yield* Scope.Scope
        const tool = makeShellTool(
          {
            job: jobs,
            session: { synthetic: (input) => Deferred.succeed(notified, input).pipe(Effect.asVoid) },
          },
          scope,
          new Set(),
        )
        const permissions = yield* Ref.make<ReadonlyArray<unknown>>([])
        yield* execute(tool, { command: "cancel", background: true }, permissions, {
          execute: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
        })
        yield* Deferred.await(started)
        yield* jobs.cancel("call_shell")

        expect((yield* Deferred.await(notified)).metadata).toMatchObject({
          source: "shell",
          shellID: "call_shell",
          state: "cancelled",
        })
      }),
    ),
  )

  it.effect("notifies exactly once per Shell generation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const release = yield* Deferred.make<void>()
        const firstNotice = yield* Deferred.make<void>()
        const secondNotice = yield* Deferred.make<void>()
        const notices = yield* Ref.make(0)
        const jobs = yield* Job.make
        const scope = yield* Scope.Scope
        const tool = makeShellTool(
          {
            job: jobs,
            session: {
              synthetic: () =>
                Ref.updateAndGet(notices, (count) => count + 1).pipe(
                  Effect.flatMap((count) => Deferred.succeed(count === 1 ? firstNotice : secondNotice, undefined)),
                  Effect.asVoid,
                ),
            },
          },
          scope,
          new Set(),
        )
        const permissions = yield* Ref.make<ReadonlyArray<unknown>>([])
        const interpreter = {
          execute: () => Deferred.await(release).pipe(Effect.as({ stdout: "done", stderr: "", exitCode: 0 })),
        }

        yield* execute(tool, { command: "once", background: true }, permissions, interpreter)
        yield* execute(tool, { command: "once", background: true }, permissions, interpreter)
        yield* Deferred.succeed(release, undefined)
        yield* Deferred.await(firstNotice)
        yield* Effect.yieldNow
        expect(yield* Ref.get(notices)).toBe(1)

        yield* execute(tool, { command: "once", background: true }, permissions, interpreter)
        yield* Deferred.await(secondNotice)
        expect(yield* Ref.get(notices)).toBe(2)
      }),
    ),
  )
})

function execute(
  tool: ReturnType<typeof makeShellTool>,
  input: { readonly command: string; readonly background?: boolean },
  permissions: Ref.Ref<ReadonlyArray<unknown>>,
  codeInterpreter: CodeInterpreter.Executor,
  progress: () => Effect.Effect<void> = () => Effect.void,
) {
  return tool
    .execute(input, {
      caller: {
        type: "session",
        projectID: Project.ID.make("prj_00000000000000000000000801"),
        sessionID,
        agent: Agent.ID.make("build"),
        messageID: MessageID.make("00000000-0000-4000-8000-000000000802"),
      },
      id: Tool.CallID.make("call_shell"),
      progress,
      elicit: () => Effect.die("unused"),
      permission: (request) => Ref.update(permissions, (items) => [...items, request]),
    })
    .pipe(
      Effect.provideService(CodeInterpreter.Service, CodeInterpreter.fixed(codeInterpreter)),
      Effect.provide(Layer.mock(AgentService.Service, {})),
    )
}
