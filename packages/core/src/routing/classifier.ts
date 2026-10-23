export * as Classifier from "./classifier.js"

import type { Routing } from "@bymorning/schema/routing"
import { Cause, Duration, Effect, Option } from "effect"
import type { Digest } from "./digest.js"
import { Judge } from "./judge.js"
import { Match } from "./match.js"

/** A classifier's choice, or why it declined so the default Tier applies. */
export type Outcome =
  | { readonly type: "chosen"; readonly tier: string; readonly cost?: number }
  | { readonly type: "declined"; readonly reason: "timeout" | "invalid" | "error"; readonly cost?: number }

/** Everything a classifier sees: only runnable Tiers and participant-written conversation. */
export interface Context {
  readonly tiers: Routing.Tiers
  readonly candidates: ReadonlyArray<Routing.Tier>
  readonly digest: Digest
  readonly judge: (request: Judge.Request) => Effect.Effect<Judge.Reply, unknown>
}

/**
 * One versioned Tier-selection strategy. New strategies (embedding similarity, an external
 * learned router, a Plugin, an adaptive bandit) register here without changing Routing's
 * public interface; the decision record carries the cause either way.
 */
export interface Classifier {
  readonly kind: string
  readonly version: number
  readonly classify: (context: Context) => Effect.Effect<Outcome>
}

/** Cheap-Model judge choosing among administrator-described Tiers. */
export const judge = {
  kind: "judge",
  version: 1,
  classify: (context) => {
    const timeout = Duration.millis(context.tiers.judge.timeout ?? Judge.defaults.timeout)
    const model = Match.resource(context.tiers.judge.model)
    const declined = (reason: "timeout" | "invalid" | "error", cost?: number) =>
      ({ type: "declined", reason, ...(cost === undefined ? {} : { cost }) }) as const
    return Effect.gen(function* () {
      const names = new Set(context.candidates.map((tier) => tier.name))
      const request = Judge.request(context.tiers.judge, context.candidates, context.digest)
      const started = yield* Effect.sync(Date.now)
      const reply = yield* context.judge(request).pipe(Effect.timeoutOption(timeout), Effect.result)
      const elapsed = yield* Effect.sync(() => Date.now() - started)
      if (reply._tag === "Failure")
        return yield* Effect.logWarning("Routing judge failed; using the default Tier", {
          judge: model,
          reason: "error",
          elapsed,
          error: reply.failure,
        }).pipe(Effect.as(declined("error")))
      if (Option.isNone(reply.success))
        return yield* Effect.logWarning("Routing judge timed out; using the default Tier", {
          judge: model,
          reason: "timeout",
          elapsed,
          timeout: Duration.toMillis(timeout),
        }).pipe(Effect.as(declined("timeout")))
      const tier = Judge.parse(reply.success.value.text, names)
      const cost = reply.success.value.cost
      if (tier !== undefined) return { type: "chosen", tier, ...(cost === undefined ? {} : { cost }) } as const
      return yield* Effect.logWarning("Routing judge named no offered Tier; using the default Tier", {
        judge: model,
        reason: "invalid",
        elapsed,
        reply: reply.success.value.text.slice(0, 200),
      }).pipe(Effect.as(declined("invalid", cost)))
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterrupts(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("Routing judge errored; using the default Tier", { judge: model, reason: "error", cause }).pipe(
              Effect.as(declined("error")),
            ),
      ),
    ) as Effect.Effect<Outcome>
  },
} satisfies Classifier

/** The classifier a Tier target uses. v1 has exactly one. */
export const select = (_tiers: Routing.Tiers): Classifier => judge
