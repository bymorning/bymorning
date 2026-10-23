import { BedrockAgentCoreClient, type CodeInterpreterStreamOutput } from "@aws-sdk/client-bedrock-agentcore"
import { Effect } from "effect"
import { expect, test } from "vitest"
import { make } from "../src/execution.js"

function fixture(events: readonly CodeInterpreterStreamOutput[]) {
  const commands: string[] = []
  let destroyed = false
  class Client extends BedrockAgentCoreClient {
    override destroy() {
      destroyed = true
      super.destroy()
    }
  }
  const client = new Client({ region: "us-east-1" })
  client.middlewareStack.add(
    (_next, context) => async () => {
      commands.push(context.commandName ?? "unknown")
      return {
        response: {},
        output: {
          $metadata: {},
          ...(context.commandName === "StartCodeInterpreterSessionCommand" ? { sessionId: "test-session" } : {}),
          ...(context.commandName === "InvokeCodeInterpreterCommand"
            ? {
                stream: (async function* () {
                  yield* events
                })(),
              }
            : {}),
        },
      }
    },
    { step: "initialize", name: "testTransport" },
  )
  return { create: () => client, commands, destroyed: () => destroyed }
}

test("opens, invokes, translates output, and releases AgentCore resources", async () => {
  const runtime = fixture([{ result: { content: [], structuredContent: { stdout: "42\n", stderr: "", exitCode: 0 } } }])
  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const executor = yield* make("resource", "us-east-1", runtime.create)
        return yield* executor.execute({ type: "code", sessionName: "test", language: "python", code: "print(42)" })
      }),
    ),
  )
  expect(result).toEqual({ stdout: "42\n", stderr: "", exitCode: 0 })
  expect(runtime.commands).toEqual([
    "StartCodeInterpreterSessionCommand",
    "InvokeCodeInterpreterCommand",
    "StopCodeInterpreterSessionCommand",
  ])
  expect(runtime.destroyed()).toBe(true)
})

test("reports an execution failure and still stops the session", async () => {
  const runtime = fixture([{ result: { content: [], isError: true, structuredContent: { stderr: "failed" } } }])
  const error = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const executor = yield* make("resource", "us-east-1", runtime.create)
        return yield* executor.execute({ type: "command", sessionName: "test", command: "exit 1" })
      }),
    ).pipe(Effect.flip),
  )
  expect(error).toMatchObject({ _tag: "CodeInterpreter.ExecutionError", operation: "output", message: "failed" })
  expect(runtime.commands.at(-1)).toBe("StopCodeInterpreterSessionCommand")
  expect(runtime.destroyed()).toBe(true)
})
