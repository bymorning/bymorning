import { define } from "@bymorning/plugin/effect/plugin"
import { Tool } from "../../../tool.js"
import { Effect, Schema, Scope } from "effect"
import type { Session } from "@bymorning/schema/session"
import { CodeInterpreter } from "../../../code-interpreter.js"
import { PluginRuntime } from "../../runtime.js"

type ShellRuntime = {
  readonly job: Pick<PluginRuntime.Interface["job"], "start" | "wait" | "block" | "background" | "cancel">
  readonly session: {
    readonly synthetic: (input: Session.SyntheticInput) => Effect.Effect<unknown, unknown>
  }
}

const Input = Schema.Struct({
  command: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(20_000)).annotate({
    description: "Shell command to execute in the isolated AgentCore environment",
  }),
  background: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Run the command in the background and notify automatically when it finishes",
  }),
})
const TerminalOutput = Schema.Struct({
  stdout: Schema.String,
  stderr: Schema.String,
  exitCode: Schema.optional(Schema.Finite),
})
const RunningOutput = Schema.Struct({
  status: Schema.Literal("running"),
  shellID: Schema.String,
})
const Output = Schema.Union([TerminalOutput, RunningOutput])

const backgroundResult = (shellID: string) => ({
  output: { status: "running" as const, shellID },
  content: [
    {
      type: "text" as const,
      text: `Shell command is running in the background (shellID: ${shellID}). You will be notified automatically when it finishes. Do not poll or duplicate this command.`,
    },
  ],
  metadata: { source: "shell", shellID, status: "running" },
})

export const makeShellTool = (runtime: ShellRuntime, scope: Scope.Scope, notifications: Set<string>) => ({
  name: "shell",
  options: { codemode: false },
  description: "Execute a shell command in a fresh isolated environment.",
  input: Input,
  output: Output,
  execute: (input: typeof Input.Type, context: Tool.Context) =>
    Effect.gen(function* () {
      if (context.caller.type !== "session")
        return yield* new Tool.Error({ message: "This Tool requires a Session caller" })
      const sessionID = context.caller.sessionID
      yield* context.permission({
        action: "shell",
        resources: [input.command],
        save: ["*"],
        metadata: { command: input.command },
      })
      const codeInterpreter = yield* CodeInterpreter.Service
      const shellID = context.id
      const run = Effect.gen(function* () {
        return yield* codeInterpreter.execute({ type: "command", sessionName: sessionID, command: input.command }).pipe(
          Effect.timeout("2 minutes"),
          Effect.mapError((error) =>
            error._tag === "TimeoutError"
              ? new Tool.Error({ message: "Shell command timed out after 2 minutes", error })
              : error._tag === "CodeInterpreter.UnavailableError"
                ? new Tool.Error({ message: CodeInterpreter.reason(error), error })
                : error,
          ),
          Effect.map(JSON.stringify),
        )
      })
      const info = yield* runtime.job.start({
        id: shellID,
        type: "shell",
        title: input.command,
        metadata: { shellID, sessionID: sessionID, command: input.command },
        run,
      })
      yield* context.progress({
        source: "shell",
        shellID,
        status: "running",
        startedAt: info.started_at,
        command: input.command,
      })

      const notifyWhenDone = Effect.fn("ShellTool.notifyWhenDone")(function* (startedAt: number) {
        const key = `${shellID}:${startedAt}`
        if (notifications.has(key)) return
        notifications.add(key)
        yield* runtime.job.wait({ id: shellID }).pipe(
          Effect.flatMap((result) => {
            const terminal = result.info
            if (!terminal || terminal.status === "running") return Effect.void
            return runtime.session.synthetic({
              sessionID: sessionID,
              text: `<shell shellID="${shellID}" state="${terminal.status}" command="${input.command}">\n${terminal.output ?? terminal.error ?? "Shell command cancelled"}\n</shell>`,
              description: input.command,
              metadata: {
                source: "shell",
                shellID,
                state: terminal.status,
                command: input.command,
                startedAt,
                ...(terminal.output ? { output: terminal.output } : {}),
                ...(terminal.error ? { error: terminal.error } : {}),
              },
            })
          }),
          Effect.forkIn(scope, { startImmediately: true }),
        )
      })

      if (input.background === true) {
        yield* runtime.job.background(shellID)
        yield* notifyWhenDone(info.started_at)
        return {
          ...backgroundResult(shellID),
          metadata: { ...backgroundResult(shellID).metadata, startedAt: info.started_at },
        }
      }
      const blocked = yield* runtime.job
        .block({ id: shellID, sessionID: sessionID })
        .pipe(Effect.onInterrupt(() => runtime.job.cancel(shellID)))
      if (blocked?.type === "backgrounded") {
        yield* notifyWhenDone(blocked.info.started_at)
        return {
          ...backgroundResult(shellID),
          metadata: { ...backgroundResult(shellID).metadata, startedAt: blocked.info.started_at },
        }
      }
      if (!blocked || blocked.info.status === "error")
        return yield* Effect.fail(
          new Tool.Error({
            message: `Shell failed: ${blocked?.info.error?.trim() || "the command failed without reporting a reason"}`,
          }),
        )
      if (blocked.info.status === "cancelled")
        return yield* Effect.fail(new Tool.Error({ message: "Shell command cancelled" }))
      const result = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(blocked.info.output).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(TerminalOutput)),
        Effect.mapError((error) => new Tool.Error({ message: "Shell returned an unreadable result", error })),
      )
      return {
        output: result,
        content: [
          {
            type: "text" as const,
            text:
              [result.stdout, result.stderr].filter((text) => text.length > 0).join("\n") ||
              `(exit ${result.exitCode ?? 0})`,
          },
        ],
        metadata: { source: "shell", shellID, status: "completed", startedAt: blocked.info.started_at },
      }
    }).pipe(Effect.scoped),
})

export const ShellPlugin = define({
  id: "core.tool.shell",
  effect: (plugin) =>
    Effect.gen(function* () {
      const runtime = yield* PluginRuntime.Service
      const scope = yield* Scope.Scope
      const interpreter = yield* CodeInterpreter.Service
      const implementation = makeShellTool(runtime, scope, new Set())
      const tool = {
        ...implementation,
        execute: (input: typeof Input.Type, context: Tool.Context) =>
          implementation.execute(input, context).pipe(Effect.provideService(CodeInterpreter.Service, interpreter)),
      } satisfies Tool.Info<typeof Input, typeof Output>
      yield* plugin.tool.transform((editor) => editor.add(tool))
    }),
})
