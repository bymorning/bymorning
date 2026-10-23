import type { Executor } from "@bymorning/plugin/effect/code-interpreter"
import { CodeInterpreter } from "@bymorning/schema/code-interpreter"
import { layer as nodeServices } from "@effect/platform-node/NodeServices"
import { Context, Effect, Layer, Scope, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { randomUUID } from "node:crypto"

const outputError = () =>
  new CodeInterpreter.ExecutionError({
    operation: "output",
    message: "Code Interpreter output exceeded 100000 characters",
  })

/** Process resources are acquired per invocation, never in the plugin activation scope. */
export const open = (config: { readonly image: string }): Effect.Effect<Executor, never, Scope.Scope> =>
  Effect.gen(function* () {
    const services = yield* Layer.build(nodeServices)
    const process = Context.get(services, ChildProcessSpawner)
    return {
      execute: Effect.fn("Docker.execute")(function* (input) {
        const name = `bymorning-execution-${randomUUID()}`
        yield* Effect.addFinalizer(() =>
          Effect.scoped(
            process.spawn(ChildProcess.make("docker", ["rm", "--force", name])).pipe(
              Effect.flatMap((handle) => handle.exitCode),
              Effect.ignore,
            ),
          ),
        )
        const program =
          input.type === "command"
            ? ["/bin/sh", "-c", input.command]
            : [
                "/bin/sh",
                "-c",
                input.language === "python"
                  ? "cat > /work/main.py && exec python3 /work/main.py"
                  : "cat > /work/main.ts && exec bun /work/main.ts",
              ]
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* process.spawn(
              ChildProcess.make(
                "docker",
                [
                  "run",
                  "--rm",
                  "--interactive",
                  "--name",
                  name,
                  "--label",
                  `bymorning.session=${input.sessionName}`,
                  "--network",
                  "none",
                  "--read-only",
                  "--cap-drop",
                  "ALL",
                  "--security-opt",
                  "no-new-privileges",
                  "--user",
                  "1000:1000",
                  "--memory",
                  "512m",
                  "--cpus",
                  "1",
                  "--pids-limit",
                  "64",
                  "--tmpfs",
                  "/tmp:rw,nosuid,nodev,size=64m,mode=1777",
                  "--tmpfs",
                  "/work:rw,nosuid,nodev,size=64m,mode=1777",
                  "--workdir",
                  "/work",
                  config.image,
                  ...program,
                ],
                {
                  killSignal: "SIGKILL",
                  stdin: input.type === "code" ? Stream.make(new TextEncoder().encode(input.code)) : Stream.empty,
                },
              ),
            )
            const collect = <E>(stream: Stream.Stream<Uint8Array, E>) =>
              stream.pipe(
                Stream.decodeText,
                Stream.runFoldEffect(
                  () => "",
                  (text, chunk) =>
                    text.length + chunk.length > 100_000 ? Effect.fail(outputError()) : Effect.succeed(text + chunk),
                ),
              )
            const [stdout, stderr, exitCode] = yield* Effect.all(
              [collect(handle.stdout), collect(handle.stderr), handle.exitCode],
              { concurrency: "unbounded" },
            )
            if (stdout.length + stderr.length > 100_000) return yield* outputError()
            if (exitCode === 125)
              return yield* new CodeInterpreter.ExecutionError({
                operation: "start",
                message: `Unable to start local Code Interpreter: ${stderr}`,
              })
            return { stdout, stderr, exitCode }
          }),
        ).pipe(
          Effect.mapError((cause) =>
            cause instanceof CodeInterpreter.ExecutionError
              ? cause
              : new CodeInterpreter.ExecutionError({
                  operation: "invoke",
                  message: "Local Code Interpreter failed",
                  cause,
                }),
          ),
        )
      }),
    }
  })
