import type { ModelScope } from "@bymorning/plugin/effect/model"
import { ModelError } from "@bymorning/schema/plugin-model"
import type { Tokens } from "@bymorning/schema/usage"
import { Cause, Effect, Exit, Scope } from "effect"

/** Executor-owned observation capability, valid until the request Scope closes. */
export interface Invocation {
  readonly usage: (tokens: Tokens) => Effect.Effect<void, ModelError>
}

/** Convert unexpected callback defects without exposing thrown data or losing interruption. */
export const guarded = <A, R>(effect: Effect.Effect<A, ModelError, R>, hook: string) => effect.pipe(
  Effect.catchCause((cause) => {
    if (Cause.hasInterrupts(cause)) return Effect.failCause(cause)
    if (!Cause.hasDies(cause)) return Effect.failCause(cause)
    return Effect.logWarning("Plugin inference callback failed", { hook }).pipe(
      Effect.andThen(Effect.fail(new ModelError({ reason: "unavailable", message: "Plugin inference hook failed" }))),
    )
  }),
)

/** Attempt every observer, then report the first failure, preserving cancellation. */
export const observe = Effect.fn("PluginHooks.observe")(function* (
  effects: ReadonlyArray<Effect.Effect<void, ModelError>>,
) {
  let failure: Exit.Failure<void, ModelError> | undefined
  for (const effect of effects) {
    const exit = yield* Effect.exit(guarded(effect, "model.invoke.usage"))
    if (Exit.isFailure(exit) && failure === undefined) failure = exit
  }
  if (failure) return yield* failure
}, Effect.uninterruptible)

/** Own a child lifetime and close it immediately if admission fails or is interrupted. */
export const lifetime = <A, E>(
  run: (scope: Scope.Scope) => Effect.Effect<A, E>,
  released: Effect.Effect<void> = Effect.void,
): Effect.Effect<A, E, Scope.Scope> => Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
  const owner = yield* Scope.Scope
  const scope = yield* Scope.make()
  const close = (exit: Exit.Exit<unknown, unknown>) => Scope.close(scope, exit).pipe(
    Effect.catchCause(() => Effect.logWarning("Plugin invocation cleanup failed")),
  )
  // Registered first, so draining waits for every resource and cleanup finalizer.
  yield* Scope.addFinalizer(scope, released)
  yield* Scope.addFinalizerExit(owner, close)
  const exit = yield* Effect.exit(restore(Effect.suspend(() => run(scope))))
  if (Exit.isFailure(exit)) yield* close(exit)
  return yield* exit
}))

/** Execute a captured ordered callback set with per-callback registration windows. */
export const admit = Effect.fn("PluginHooks.admit")(function* (
  scope: Scope.Scope,
  callbacks: ReadonlyArray<(scope: ModelScope) => Effect.Effect<void, ModelError, Scope.Scope>>,
) {
  const observers: Array<(tokens: Tokens) => Effect.Effect<void, ModelError>> = []
  const finalizers: Array<Effect.Effect<void>> = []
  let closed = false
  let used = false
  yield* Scope.addFinalizer(scope, Effect.gen(function* () {
    closed = true
    for (const finalizer of finalizers.toReversed()) {
      yield* finalizer.pipe(Effect.catchCause(() => Effect.logWarning("Plugin invocation finalizer failed")))
    }
  }))
  for (const callback of callbacks) {
    let active = true
    const assertActive = () => {
      if (!active || closed) throw new TypeError("Invocation registration is closed")
    }
    const input = {
      onUsage: (observer) => { assertActive(); observers.push(observer) },
      onClose: (finalizer) => { assertActive(); finalizers.push(finalizer) },
    } as ModelScope
    yield* guarded(Effect.suspend(() => callback(input)), "model.invoke").pipe(
      Scope.provide(scope),
      Effect.ensuring(Effect.sync(() => { active = false })),
    )
  }
  return {
    usage: Effect.fn("PluginHooks.usage")(function* (tokens: Tokens) {
      if (used || closed) return
      used = true
      const frozen = Object.freeze({ ...tokens })
      yield* observe(observers.map((observer) => Effect.suspend(() => observer(frozen))))
    }, Effect.uninterruptible),
  } satisfies Invocation
})
