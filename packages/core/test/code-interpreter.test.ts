import { describe, expect, it } from "@effect/vitest"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { CodeInterpreter } from "../src/code-interpreter.js"

const input: CodeInterpreter.ExecuteInput = { type: "command", sessionName: "test", command: "echo test" }
const executor = (value: string): CodeInterpreter.Executor => ({
  execute: () => Effect.succeed({ stdout: value, stderr: "", exitCode: 0 }),
})

describe("CodeInterpreter", () => {
  it.effect("uses the startup default and refuses an unavailable selection without fallback", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(CodeInterpreter.layer("one"))
        const service = Context.get(context, CodeInterpreter.Service)
        yield* service.transform((editor) => editor.add({ id: "one", name: "One", open: Effect.succeed(executor("one")) }))
        expect((yield* service.execute(input)).stdout).toBe("one")
        yield* service.transform((editor) => editor.default.set("missing"))
        const result = yield* service.execute(input).pipe(Effect.flip)
        expect(result).toBeInstanceOf(CodeInterpreter.UnavailableError)
      }),
    ),
  )

  it.effect("removes scoped registrations and rejects duplicate active IDs", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(CodeInterpreter.layer())
        const service = Context.get(context, CodeInterpreter.Service)
        const child = yield* Scope.fork(yield* Scope.Scope)
        yield* service.transform((editor) => {
          editor.add({ id: "one", name: "One", open: Effect.succeed(executor("one")) })
          editor.default.set("one")
        }).pipe(Effect.provideService(Scope.Scope, child))
        expect((yield* service.execute(input)).stdout).toBe("one")
        const duplicate = yield* service.transform((editor) => editor.add({ id: "one", name: "Again", open: Effect.succeed(executor("two")) })).pipe(Effect.exit)
        expect(duplicate._tag).toBe("Failure")
        yield* Scope.close(child, Exit.void)
        expect(yield* service.execute(input).pipe(Effect.flip)).toBeInstanceOf(CodeInterpreter.UnavailableError)
      }),
    ),
  )

  it.effect("lets an in-flight execution finish after its registration unloads", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(CodeInterpreter.layer())
        const service = Context.get(context, CodeInterpreter.Service)
        const started = yield* Deferred.make<void>()
        const finish = yield* Deferred.make<void>()
        const registrationScope = yield* Scope.fork(yield* Scope.Scope)
        yield* service.transform((editor) => {
          editor.add({
            id: "one",
            name: "One",
            open: Effect.succeed({
              execute: () =>
                Effect.gen(function* () {
                  yield* Deferred.succeed(started, undefined)
                  yield* Deferred.await(finish)
                  return { stdout: "done", stderr: "", exitCode: 0 }
                }),
            }),
          })
          editor.default.set("one")
        }).pipe(Effect.provideService(Scope.Scope, registrationScope))
        const running = yield* Effect.forkChild(service.execute(input))
        yield* Deferred.await(started)
        yield* Scope.close(registrationScope, Exit.void)
        yield* Deferred.succeed(finish, undefined)
        expect((yield* Fiber.join(running)).stdout).toBe("done")
        expect(yield* service.execute(input).pipe(Effect.flip)).toBeInstanceOf(CodeInterpreter.UnavailableError)
      }),
    ),
  )
})
