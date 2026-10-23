import { expect, test } from "vitest"
import { Effect, Redacted } from "effect"
import { Auth } from "@bymorning/schema/auth"
import { WebProvider } from "../../web-provider.js"
import { LocalWebProvider } from "./identity-local.js"

test("local login issues localhost callbacks, verifies the verifier, and rejects replay", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const provider = yield* WebProvider.Service
      const callback = new URL("http://localhost:3000/auth/callback")
      const started = yield* provider.start(callback)
      expect(started.redirect.origin).toBe(callback.origin)
      const input = {
        code: Redacted.make(started.redirect.searchParams.get("code")!),
        state: started.state,
        verifier: started.verifier,
        redirectURI: callback,
      }
      expect(yield* provider.complete(input)).toEqual({
        provider: "local",
        subject: "developer",
        verifiedEmail: "developer@local.test",
      })
      expect((yield* provider.complete(input).pipe(Effect.exit))._tag).toBe("Failure")
      const second = yield* provider.start(callback)
      expect(
        (yield* provider
          .complete({
            ...input,
            code: Redacted.make(second.redirect.searchParams.get("code")!),
            verifier: Redacted.make("wrong"),
          })
          .pipe(Effect.exit))._tag,
      ).toBe("Failure")
      expect((yield* provider.start(new URL("https://example.com/auth/callback")).pipe(Effect.exit))._tag).toBe(
        "Failure",
      )
    }).pipe(
      Effect.provide(
        LocalWebProvider.layer({
          subject: Auth.Sub.make("developer"),
          email: Auth.Email.make("developer@local.test"),
        }),
      ),
    ),
  )
})
