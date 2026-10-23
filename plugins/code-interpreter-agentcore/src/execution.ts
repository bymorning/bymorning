import { CodeInterpreter } from "@bymorning/schema/code-interpreter"
import { Effect, Stream } from "effect"
import type { Executor } from "@bymorning/plugin/effect/code-interpreter"
import type { Output } from "@bymorning/schema/code-interpreter"
import type { Scope } from "effect"
const { ExecutionError } = CodeInterpreter
import {
  BedrockAgentCoreClient,
  InvokeCodeInterpreterCommand,
  StartCodeInterpreterSessionCommand,
  StopCodeInterpreterSessionCommand,
  type CodeInterpreterStreamOutput,
} from "@aws-sdk/client-bedrock-agentcore"
const OUTPUT_LIMIT = 100_000
const SESSION_TIMEOUT_SECONDS = 900
/** Acquire an AgentCore client configured for one Code Interpreter resource. */
export const make = (
  identifier: string,
  region?: string,
  create: () => BedrockAgentCoreClient = () => new BedrockAgentCoreClient({ region }),
): Effect.Effect<Executor, never, Scope.Scope> =>
  Effect.gen(function* () {
    const client = yield* Effect.acquireRelease(Effect.sync(create), (client) => Effect.sync(() => client.destroy()))
    return {
      execute: Effect.fn("CodeInterpreter.execute")(function* (input) {
        const sessionID = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: (signal) =>
              client.send(
                new StartCodeInterpreterSessionCommand({
                  codeInterpreterIdentifier: identifier,
                  name: input.sessionName,
                  sessionTimeoutSeconds: SESSION_TIMEOUT_SECONDS,
                }),
                { abortSignal: signal },
              ),
            catch: (cause) =>
              new ExecutionError({ operation: "start", message: "Failed to start Code Interpreter session", cause }),
          }).pipe(
            Effect.flatMap((started) =>
              started.sessionId === undefined
                ? Effect.fail(new ExecutionError({ operation: "start", message: "AgentCore returned no session ID" }))
                : Effect.succeed(started.sessionId),
            ),
          ),
          (sessionID) =>
            Effect.tryPromise(() =>
              client.send(
                new StopCodeInterpreterSessionCommand({
                  codeInterpreterIdentifier: identifier,
                  sessionId: sessionID,
                }),
              ),
            ).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Failed to stop AgentCore Code Interpreter session").pipe(
                  Effect.annotateLogs({ sessionID, cause }),
                ),
              ),
              Effect.asVoid,
            ),
        )

        const response = yield* Effect.tryPromise({
          try: (signal) =>
            client.send(
              new InvokeCodeInterpreterCommand({
                codeInterpreterIdentifier: identifier,
                sessionId: sessionID,
                name: input.type === "command" ? "executeCommand" : "executeCode",
                arguments:
                  input.type === "command"
                    ? { command: input.command }
                    : { code: input.code, language: input.language, clearContext: true },
              }),
              { abortSignal: signal },
            ),
          catch: (cause) =>
            new ExecutionError({ operation: "invoke", message: "Failed to invoke Code Interpreter", cause }),
        })
        if (response.stream === undefined)
          return yield* new ExecutionError({ operation: "stream", message: "AgentCore returned no output stream" })

        return yield* Stream.fromAsyncIterable(
          response.stream,
          (cause) =>
            new ExecutionError({ operation: "stream", message: "Code Interpreter output stream failed", cause }),
        ).pipe(Stream.runFoldEffect(emptyOutput, appendOutput))
      }),
    }
  })

const emptyOutput = (): Output => ({ stdout: "", stderr: "" })

const appendOutput = (output: Output, event: CodeInterpreterStreamOutput) =>
  outputEvent(event).pipe(
    Effect.flatMap((update) => {
      const next = {
        stdout: output.stdout + update.stdout,
        stderr: output.stderr + update.stderr,
        exitCode: update.exitCode ?? output.exitCode,
      }
      return next.stdout.length + next.stderr.length > OUTPUT_LIMIT
        ? Effect.fail(
            new ExecutionError({
              operation: "output",
              message: `Code Interpreter output exceeded ${OUTPUT_LIMIT} characters`,
            }),
          )
        : Effect.succeed(next)
    }),
  )

const outputEvent = (event: CodeInterpreterStreamOutput): Effect.Effect<Output, CodeInterpreter.ExecutionError> => {
  if (event.result === undefined) {
    const entry = Object.entries(event).find(([name]) => name !== "$unknown")
    return Effect.fail(
      new ExecutionError({
        operation: "stream",
        message:
          entry === undefined ? "Unknown Code Interpreter output event" : `Code Interpreter output failed: ${entry[0]}`,
        cause: entry?.[1],
      }),
    )
  }
  const structured = event.result.structuredContent
  const text =
    event.result.content?.flatMap((content) => (content.text === undefined ? [] : [content.text])).join("") ?? ""
  if (event.result.isError) {
    const message = structured?.stderr || text || "Code Interpreter execution failed"
    return Effect.fail(
      new ExecutionError({
        operation: "output",
        message:
          message.length > OUTPUT_LIMIT ? `Code Interpreter error output exceeded ${OUTPUT_LIMIT} characters` : message,
      }),
    )
  }
  return Effect.succeed({
    stdout: structured?.stdout ?? (structured?.stderr === undefined ? text : ""),
    stderr: structured?.stderr ?? "",
    ...(structured?.exitCode === undefined ? {} : { exitCode: structured.exitCode }),
  })
}
