import { expect, test } from "vitest"
import { Effect, Fiber } from "effect"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { CodeInterpreter } from "@bymorning/schema/code-interpreter"
import { open } from "../src/execution.js"

const image = process.env.LOCAL_EXECUTION_IMAGE
const execution = open({ image: image ?? "bymorning-code-interpreter:local" })
const run = (input: CodeInterpreter.ExecuteInput) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const interpreter = yield* execution
        return yield* interpreter.execute(input)
      }),
    ),
  )

test.runIf(image)(
  "executes Python, JavaScript, TypeScript and shell in isolated local containers",
  async () => {
    for (const [language, code] of [
      ["python", "print(6 * 7)"],
      ["javascript", "console.log(6 * 7)"],
      ["typescript", "const value: number = 6 * 7; console.log(value)"],
    ] as const) {
      expect(await run({ type: "code", sessionName: "local-test", language, code })).toMatchObject({
        stdout: "42\n",
        stderr: "",
        exitCode: 0,
      })
    }
    expect(
      await run({
        type: "command",
        sessionName: "local-test",
        command: "echo isolated > /work/probe; cat /work/probe",
      }),
    ).toMatchObject({ stdout: "isolated\n", exitCode: 0 })
    expect(
      await run({
        type: "command",
        sessionName: "local-test",
        command:
          'test ! -e /work/probe && test -z "$AWS_ACCESS_KEY_ID" && test -z "$SST_RESOURCE_Storage" && echo fresh',
      }),
    ).toMatchObject({ stdout: "fresh\n", exitCode: 0 })
  },
  30_000,
)

test.runIf(image)("retains stderr and nonzero exit status", async () => {
  expect(await run({ type: "command", sessionName: "local-test", command: "echo failed >&2; exit 7" })).toMatchObject({
    stdout: "",
    stderr: "failed\n",
    exitCode: 7,
  })
})

test.runIf(image)(
  "removes the running container when execution is cancelled",
  async () => {
    const sessionName = randomUUID()
    const running = Effect.runFork(
      Effect.scoped(
        Effect.gen(function* () {
          const interpreter = yield* execution
          return yield* interpreter.execute({ type: "command", sessionName, command: "sleep 60" })
        }),
      ),
    )
    const containers = () =>
      execFileSync(
        "docker",
        ["ps", "--all", "--filter", `label=bymorning.session=${sessionName}`, "--format", "{{.ID}}"],
        { encoding: "utf8" },
      ).trim()
    try {
      await expect.poll(containers, { timeout: 10_000 }).not.toBe("")
      await Effect.runPromise(Fiber.interrupt(running))
      expect(containers()).toBe("")
    } finally {
      await Effect.runPromise(Fiber.interrupt(running))
    }
  },
  15_000,
)

test.runIf(image)("reports output limits through the shared execution error contract", async () => {
  await expect(
    run({ type: "code", sessionName: "output-test", language: "python", code: "print('x' * 100001)" }),
  ).rejects.toMatchObject({ operation: "output" })
})
