export * as SessionRetry from "./retry.js"

import { AIError } from "@opencode-ai/ai/schema/errors"
import type { ID } from "@bymorning/schema/message"
import { Session } from "@bymorning/schema/session"
import { SessionError } from "@bymorning/schema/session-error"
import { SessionEvent } from "@bymorning/schema/session-event"
import { Clock, Duration, Effect, Pull, Schedule } from "effect"
import { Provider } from "../provider.js"

export interface Decision {
  readonly attempt: number
  readonly delay: number
}

export interface Interface {
  readonly attempt: () => number
  readonly decide: (failure: Provider.FailureError) => Effect.Effect<Decision | undefined>
  readonly wait: (input: {
    readonly decision: Decision
    readonly messageID: ID
    readonly error: SessionError.Error
  }) => Effect.Effect<void>
}

const RETRY_AFTER_MAX = Duration.toMillis("15 minutes")
const schedule = Schedule.max([Schedule.exponential("2 seconds"), Schedule.recurs(4)]).pipe(
  Schedule.jittered,
  Schedule.setInputType<AIError>(),
  Schedule.modifyDelay(({ input, duration }) => {
    const retryAfter =
      input.reason._tag === "RateLimit" || input.reason._tag === "ProviderInternal"
        ? input.reason.retryAfterMs
        : undefined
    const minimum = retryAfter === undefined ? undefined : Math.min(retryAfter, RETRY_AFTER_MAX)
    return Effect.succeed(
      Duration.millis(
        Math.ceil(
          Duration.toMillis(minimum === undefined ? duration : Duration.max(duration, Duration.millis(minimum))),
        ),
      ),
    )
  }),
)

/** Build one bounded physical-request retry budget. */
export const make = (
  publish: (data: typeof SessionEvent.RetryScheduled.data.Type) => Effect.Effect<void>,
  sessionID: Session.ID,
): Effect.Effect<Interface> =>
  Effect.gen(function* () {
    const step = yield* Schedule.toStep(schedule)
    let attempt = 1
    const decide = Effect.fn("SessionRetry.decide")(function* (failure: Provider.FailureError) {
      if (!(failure.cause instanceof AIError) || !isRetryable(failure.cause)) return undefined
      const next = yield* step(yield* Clock.currentTimeMillis, failure.cause).pipe(Pull.catchDone(() => Effect.void))
      if (next === undefined) return undefined
      attempt++
      return { attempt, delay: Math.ceil(Duration.toMillis(next[1])) } satisfies Decision
    })
    const wait = Effect.fn("SessionRetry.wait")(function* (input: {
      readonly decision: Decision
      readonly messageID: ID
      readonly error: SessionError.Error
    }) {
      const scheduled = yield* Clock.currentTimeMillis
      const at = scheduled + input.decision.delay
      yield* publish({
        sessionID,
        messageID: input.messageID,
        attempt: input.decision.attempt,
        at: new Date(at),
        error: input.error,
      })
      yield* Effect.logWarning("Provider execution retrying").pipe(
        Effect.annotateLogs({ sessionID, messageID: input.messageID, attempt: input.decision.attempt }),
      )
      yield* Effect.sleep(Duration.millis(Math.max(0, at - (yield* Clock.currentTimeMillis))))
    })
    return { attempt: () => attempt, decide, wait }
  })

function isRetryable(error: AIError) {
  const override = error.reason.http?.headers["x-should-retry"]
  if (override === "true") return true
  if (override === "false") return false
  switch (error.reason._tag) {
    case "RateLimit":
    case "ProviderInternal":
    case "UnknownProvider":
      return true
    case "Transport":
      // No delivery observation is ambiguous, rather than proof that the
      // request was never received. Retrying it could duplicate provider work.
      return error.reason.delivery === "not-sent"
    case "InvalidProviderOutput":
      return error.reason.classification === "incomplete-stream"
    case "Authentication":
    case "QuotaExceeded":
    case "ContentPolicy":
    case "InvalidRequest":
    case "NoRoute":
    case "UnsupportedOperation":
      return false
  }
}
