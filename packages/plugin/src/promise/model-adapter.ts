import { ModelError } from "@bymorning/schema/plugin-model"
import type { ModelScope } from "../effect/model.js"
import type { ModelScope as PromiseScope } from "./model.js"
import { Effect, Schema } from "effect"

const Result = Schema.Union([Schema.Undefined, ModelError])

/** Decode inference-hook results at the untyped Promise boundary. */
export const result = Effect.fn("Plugin.modelResult")(function* (
  pluginID: string,
  hook: string,
  evaluate: (signal: AbortSignal) => Promise<unknown>,
) {
  const unavailable = () => new ModelError({ reason: "unavailable", message: "Plugin inference hook failed" })
  const value = yield* Effect.tryPromise({ try: evaluate, catch: unavailable }).pipe(
    Effect.flatMap((value) => Schema.decodeUnknownEffect(Result)(value)),
    Effect.catch(() => Effect.logWarning("Plugin inference hook failed", { pluginID, hook }).pipe(
      Effect.andThen(Effect.fail(unavailable())),
    )),
  )
  if (value !== undefined) return yield* Effect.fail(value)
})

/** Adapt invocation work in its executing Scope, never in the captured setup Scope. */
export const invoke = <Input extends ModelScope>(
  pluginID: string,
  hook: string,
  callback: (input: Omit<Input, keyof ModelScope> & PromiseScope) => unknown,
  input: Input,
) => Effect.suspend(() => {
  const controller = new AbortController()
  let active = true
  input.onClose(Effect.sync(() => controller.abort()))
  const assertActive = () => {
    if (!active) throw new TypeError("Invocation registration is closed")
  }
  const adapted = Object.freeze({
    ...input,
    signal: controller.signal,
    onUsage: (observe: Parameters<PromiseScope["onUsage"]>[0]) => {
      assertActive()
      input.onUsage((tokens) => result(pluginID, `${hook}.usage`, () => Promise.resolve().then(() => observe(tokens))))
    },
    onClose: (close: Parameters<PromiseScope["onClose"]>[0]) => {
      assertActive()
      input.onClose(Effect.promise(() => {
        controller.abort()
        return Promise.resolve().then(close)
      }))
    },
  })
  return result(pluginID, hook, (signal) => {
    signal.addEventListener("abort", () => controller.abort(), { once: true })
    return Promise.resolve().then(() => callback(adapted)).finally(() => { active = false })
  }).pipe(Effect.ensuring(Effect.sync(() => { active = false })))
})
