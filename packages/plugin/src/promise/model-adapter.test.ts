import { describe, expect, it } from "vitest"
import { Cause, Effect, Exit } from "effect"
import { ModelError } from "@bymorning/schema/plugin-model"
import { invoke, result } from "./model-adapter.js"
import type { ModelScope } from "./model.js"

describe("Promise model adapter", () => {
  it("preserves typed refusals and safely maps invalid or rejected results", async () => {
    const denied = new ModelError({ reason: "budget", message: "Budget exceeded", retryAfter: 42 })
    const refusal = await Effect.runPromise(result("test", "model.invoke", () => Promise.resolve(denied)).pipe(Effect.flip))
    expect(refusal).toEqual(denied)
    for (const evaluate of [() => Promise.resolve({ secret: "private" }), () => Promise.reject(new Error("private"))]) {
      const error = await Effect.runPromise(result("test", "model.invoke", evaluate).pipe(Effect.flip))
      expect(error.reason).toBe("unavailable")
      expect(JSON.stringify(error)).not.toContain("private")
    }
  })

  it("closes registration when the Promise exits and aborts before cleanup", async () => {
    const finalizers: Array<Effect.Effect<void>> = []
    let retained: ModelScope | undefined
    let aborted = false
    await Effect.runPromise(invoke("test", "model.invoke", (input) => {
      retained = input
      input.onClose(() => { aborted = input.signal.aborted })
    }, {
      onUsage: () => {},
      onClose: (effect: Effect.Effect<void>) => { finalizers.push(effect) },
    }))
    expect(() => retained?.onUsage(() => {})).toThrow("registration is closed")
    expect(() => retained?.onClose(() => {})).toThrow("registration is closed")
    for (const effect of finalizers.toReversed()) await Effect.runPromise(effect)
    expect(aborted).toBe(true)
  })

  it("preserves interruption and aborts an in-flight Promise", async () => {
    let entered: () => void = () => {}
    const started = new Promise<void>((resolve) => { entered = resolve })
    const controller = new AbortController()
    let signal: AbortSignal | undefined
    const running = Effect.runPromiseExit(invoke("test", "model.invoke", (input) => {
      signal = input.signal
      entered()
      return new Promise<void>((resolve) => input.signal.addEventListener("abort", () => resolve()))
    }, { onUsage: () => {}, onClose: () => {} }), { signal: controller.signal })
    await started
    controller.abort()
    const exit = await running
    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
    expect(signal?.aborted).toBe(true)
  })
})
