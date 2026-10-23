import { Provider } from "@bymorning/core/provider"
import { ID } from "@bymorning/schema/message"
import { Session } from "@bymorning/schema/session"
import { SessionError } from "@bymorning/schema/session-error"
import { AIError, ProviderInternalError, RateLimitError, TransportError } from "@opencode-ai/ai/schema/errors"
import { Effect, Ref } from "effect"
import { TestClock } from "effect/testing"
import { expect, test } from "vitest"
import { SessionRetry } from "../../src/session/retry.js"

const sessionID = Session.ID.make("00000000-0000-4000-8000-000000000701")
const messageID = ID.make("00000000-0000-4000-8000-000000000702")
const error = SessionError.Provider.make({ message: "Provider execution failed" })

test("publishes before sleeping without extending Retry-After for publication time", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const published = yield* Ref.make<ReadonlyArray<{ readonly attempt: number; readonly at: Date }>>([])
      const retry = yield* SessionRetry.make(
        (data) =>
          Ref.update(published, (events) => [...events, { attempt: data.attempt, at: data.at }]).pipe(
            Effect.andThen(TestClock.adjust("5 seconds")),
          ),
        sessionID,
      )
      const decision = yield* retry.decide(
        new Provider.FailureError({
          cause: new AIError({
            reason: new RateLimitError({ message: "limited", retryAfterMs: 5_000 }),
          }),
        }),
      )
      if (decision === undefined) return yield* Effect.die("Expected retry decision")
      yield* retry.wait({ decision, messageID, error })
      expect(yield* Ref.get(published)).toEqual([{ attempt: 2, at: new Date(5_000) }])
    }).pipe(Effect.provide(TestClock.layer())),
  ))

test("uses four bounded jittered exponential retries", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const retry = yield* SessionRetry.make(() => Effect.void, sessionID)
      const failure = new Provider.FailureError({
        cause: new AIError({
          reason: new ProviderInternalError({ message: "temporary" }),
        }),
      })
      const decisions = []
      for (let index = 0; index < 5; index++) decisions.push(yield* retry.decide(failure))

      expect(decisions.slice(0, 4).map((decision) => decision?.attempt)).toEqual([2, 3, 4, 5])
      const delays = decisions.slice(0, 4).map((decision) => decision?.delay ?? 0)
      for (const [delay, [minimum, maximum]] of delays.map(
        (delay, index) => [delay, [1_600 * 2 ** index, 2_400 * 2 ** index]] as const,
      )) {
        expect(delay).toBeGreaterThanOrEqual(minimum)
        expect(delay).toBeLessThanOrEqual(maximum)
      }
      expect(decisions[4]).toBeUndefined()
    }),
  ))

test("retries transport failures only when delivery is known not to have started", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const retry = yield* SessionRetry.make(() => Effect.void, sessionID)
      const ambiguous = new Provider.FailureError({
        cause: new AIError({
          reason: new TransportError({ message: "connection dropped", transport: "http", operation: "request" }),
        }),
      })
      const notSent = new Provider.FailureError({
        cause: new AIError({
          reason: new TransportError({
            message: "connection refused",
            transport: "http",
            operation: "request",
            delivery: "not-sent",
          }),
        }),
      })

      expect(yield* retry.decide(ambiguous)).toBeUndefined()
      expect(yield* retry.decide(notSent)).toMatchObject({ attempt: 2 })
    }),
  ))
