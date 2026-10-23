import { CodeInterpreter } from "@bymorning/core/code-interpreter"
import { Config } from "@bymorning/core/config"
import { Plugin } from "@bymorning/core/plugin"
import { AccountActor } from "@bymorning/schema/actor"
import { CodeInterpreter as InterpreterSchema } from "@bymorning/schema/code-interpreter"
import { Plugin as PluginSchema } from "@bymorning/schema/plugin"
import { Effect, Fiber } from "effect"
import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { promisify } from "node:util"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"

const docker = promisify(execFile)

test("loads installation packages, applies Workspace selection, and reloads plugin options through the SDK", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make({
          execution: "docker",
          plugins: [
            {
              package: "@bymorning/plugin-code-interpreter-agentcore",
              options: { identifier: "test-resource", region: "us-east-1" },
            },
          ],
        })
        const owner = yield* app.login()
        const account = new AccountActor({ type: "account", properties: { accountID: owner.properties.accountID } })
        const inventory = yield* app.workspace({ account }, Plugin.Service.use((plugin) => plugin.list()))
        expect(inventory.find((plugin) => plugin.id === "docker")).toMatchObject({
          status: "active",
          source: { type: "package", package: "@bymorning/plugin-code-interpreter-docker" },
        })
        expect(inventory.find((plugin) => plugin.id === "agentcore")).toMatchObject({ status: "active" })
        yield* app.workspace(
          { account },
          Effect.scoped(
            Effect.gen(function* () {
              const interpreter = yield* CodeInterpreter.Service
              const config = yield* Config.Service
              const supervisor = yield* Plugin.Supervisor.Service
              const selected = (id: string | undefined) =>
                Effect.promise(() =>
                  expect
                    .poll(() =>
                      Effect.runPromise(interpreter.default().pipe(Effect.map((info) => info?.id)), { signal }),
                    )
                    .toBe(id),
                )
              expect((yield* interpreter.default())?.id).toBe("docker")
              const entries = yield* config.entries()
              expect(entries[0]?.path).toMatch(/app\/host\/bymorning.docker.jsonc$/)
              expect(entries.at(-1)?.info.code_interpreter).toBeUndefined()
              const stored = entries.at(-1)!.info
              yield* supervisor.reloadAfter(
                config.update(
                  {
                    ...stored,
                    code_interpreter: { implementation: InterpreterSchema.ID.make("agentcore") },
                  },
                  owner,
                ),
              )
              yield* selected("agentcore")
              yield* supervisor.reloadAfter(
                config.update(
                  {
                    ...stored,
                    code_interpreter: { implementation: InterpreterSchema.ID.make("missing") },
                  },
                  owner,
                ),
              )
              yield* selected(undefined)
              expect(
                yield* interpreter
                  .execute({ type: "command", command: "echo test", sessionName: "missing" })
                  .pipe(Effect.flip),
              ).toBeInstanceOf(CodeInterpreter.UnavailableError)
              yield* supervisor.reloadAfter(config.update(stored, owner))
              yield* selected("docker")
            }),
          ),
        )
        const image = (yield* Effect.tryPromise(() =>
          docker("docker", ["image", "inspect", "bymorning-code-interpreter:local", "--format", "{{.Id}}"]),
        )).stdout.trim()
        const configured = yield* app.workspace(
          { account },
          Plugin.configure(PluginSchema.ID.make("docker"), { image }),
        )
        expect(configured.status).toBe("active")
        yield* app.workspace(
          { account },
          Effect.scoped(
            Effect.gen(function* () {
              const interpreter = yield* CodeInterpreter.Service
              expect(
                yield* interpreter.execute({
                  type: "code",
                  sessionName: "packaged-docker",
                  language: "python",
                  code: "print(6 * 7)",
                }),
              ).toMatchObject({ stdout: "42\n", stderr: "", exitCode: 0 })
            }),
          ),
        )
        const interpreter = yield* app.workspace({ account }, CodeInterpreter.Service)
        const sessionName = randomUUID()
        const running = yield* Effect.forkChild(
          Effect.scoped(
            interpreter.execute({
              type: "command",
              sessionName,
              command: "mkfifo /work/release; cat /work/release",
            }),
          ),
        )
        let container = ""
        yield* Effect.promise(() =>
          expect
            .poll(
              async () => {
                container = (
                  await docker("docker", [
                    "ps",
                    "--filter",
                    `label=bymorning.session=${sessionName}`,
                    "--format",
                    "{{.ID}}",
                  ])
                ).stdout.trim()
                if (!container) return false
                try {
                  await docker("docker", ["exec", container, "test", "-p", "/work/release"])
                  return true
                } catch {
                  return false
                }
              },
              { timeout: 10_000 },
            )
            .toBe(true),
        )
        expect(
          (yield* Effect.tryPromise(() =>
            docker("docker", ["inspect", container, "--format", "{{.Image}}"]),
          )).stdout.trim(),
        ).toBe(image)
        yield* app.workspace(
          { account },
          Effect.scoped(
            Effect.gen(function* () {
              const config = yield* Config.Service
              const supervisor = yield* Plugin.Supervisor.Service
              const stored = (yield* config.entries()).at(-1)!.info
              yield* supervisor.reloadAfter(
                config.update({ ...stored, plugins: [...(stored.plugins ?? []), "-docker"] }, owner),
              )
              const interpreter = yield* CodeInterpreter.Service
              expect((yield* interpreter.list()).map((entry) => entry.id)).not.toContain("docker")
              expect(
                yield* interpreter
                  .execute({ type: "command", command: "echo test", sessionName: "removed" })
                  .pipe(Effect.flip),
              ).toBeInstanceOf(CodeInterpreter.UnavailableError)
            }),
          ),
        )
        yield* Effect.tryPromise(() =>
          docker("docker", ["exec", container, "/bin/sh", "-c", "echo retained > /work/release"]),
        )
        expect(yield* Fiber.join(running)).toMatchObject({ stdout: "retained\n", exitCode: 0 })
        expect(
          (yield* Effect.tryPromise(() =>
            docker("docker", [
              "ps",
              "--all",
              "--filter",
              `label=bymorning.session=${sessionName}`,
              "--format",
              "{{.ID}}",
            ]),
          )).stdout.trim(),
        ).toBe("")
      }),
    ),
    { signal },
  )
}, 90_000)
