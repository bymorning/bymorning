import { describe, expect, it } from "@effect/vitest"
import { Account } from "@bymorning/schema/account"
import { Workspace } from "@bymorning/schema/workspace"
import { Effect, Exit, Scope } from "effect"
import { IntegrationOAuthCallback } from "../src/integration-oauth-callback.js"

const owner = (accountID: string) => ({
  accountID: Account.ID.make(accountID),
  workspaceID: Workspace.ID.make(`wrk_${accountID}`),
  pluginID: "example.oauth",
})

describe("IntegrationOAuthCallback", () => {
  it.effect("generates unique account-scoped, one-use states and delivers provider responses", () =>
    Effect.gen(function* () {
      const callbacks = yield* IntegrationOAuthCallback.Service
      const first = yield* callbacks.register(owner("acc_first"))
      const second = yield* callbacks.register(owner("acc_second"))

      expect(first.state).not.toBe(second.state)
      expect(first.state).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(first.callbackURI).toBe("https://app.example/auth/integration/callback")
      expect(
        yield* callbacks.deliver({ state: second.state, error: "access_denied", errorDescription: "Denied" }),
      ).toBe(true)
      expect(yield* second.wait).toEqual({ error: "access_denied", errorDescription: "Denied" })
      expect(yield* callbacks.deliver({ state: second.state, code: "replay" })).toBe(false)
      expect(yield* callbacks.deliver({ state: first.state, code: "account-one-code" })).toBe(true)
      expect(yield* first.wait).toEqual({ code: "account-one-code" })
    }).pipe(Effect.provide(IntegrationOAuthCallback.layer(new URL("https://app.example")))),
  )

  it.effect("removes registrations on cancellation and plugin scope close", () =>
    Effect.gen(function* () {
      const callbacks = yield* IntegrationOAuthCallback.Service
      const scope = yield* Scope.make()
      const cancelled = yield* callbacks.register(owner("acc_cancelled")).pipe(Scope.provide(scope))
      yield* Scope.close(scope, Exit.void)

      expect(yield* callbacks.deliver({ state: cancelled.state, code: "late" })).toBe(false)
      expect(yield* callbacks.deliver({ code: "missing-state" })).toBe(false)
    }).pipe(Effect.provide(IntegrationOAuthCallback.layer(new URL("https://app.example")))),
  )

  it.effect("rejects expired registrations", () =>
    Effect.gen(function* () {
      const callbacks = yield* IntegrationOAuthCallback.Service
      const expired = yield* callbacks.register(owner("acc_expired"))
      expect(yield* callbacks.deliver({ state: expired.state, code: "late" })).toBe(false)
    }).pipe(Effect.provide(IntegrationOAuthCallback.layer(new URL("https://app.example"), 0))),
  )

  it.effect("does not consume state for malformed or oversized responses", () =>
    Effect.gen(function* () {
      const callbacks = yield* IntegrationOAuthCallback.Service
      const missing = yield* callbacks.register(owner("acc_missing"))
      expect(yield* callbacks.deliver({ state: missing.state })).toBe(false)
      expect(yield* callbacks.deliver({ state: missing.state, code: "valid" })).toBe(true)
      expect(yield* missing.wait).toEqual({ code: "valid" })

      const oversized = yield* callbacks.register(owner("acc_oversized"))
      expect(yield* callbacks.deliver({ state: oversized.state, code: "x".repeat(4097) })).toBe(false)
      expect(yield* callbacks.deliver({ state: oversized.state, code: "valid" })).toBe(true)

      const malformedError = yield* callbacks.register(owner("acc_error"))
      expect(
        yield* callbacks.deliver({
          state: malformedError.state,
          error: "access_denied",
          errorDescription: "x".repeat(4097),
        }),
      ).toBe(false)
      expect(yield* callbacks.deliver({ state: malformedError.state, error: "access_denied" })).toBe(true)
    }).pipe(Effect.provide(IntegrationOAuthCallback.layer(new URL("https://app.example")))),
  )
})
