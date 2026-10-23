import { ByMorning } from "@bymorning/client"
import { Auth } from "@bymorning/core/auth"
import { Effect } from "effect"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"

test("current Account is cookie-bound, reflects refreshed email, and requires login after logout", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const anonymous = ByMorning.make({ baseUrl: app.origin.href })
        const denied = yield* Effect.tryPromise(() => anonymous.account.get()).pipe(Effect.flip)
        expect(denied.cause).toMatchObject({ _tag: "UnauthorizedError" })

        const owner = yield* app.login()
        const profile = { id: owner.properties.accountID, email: "owner@bymorning.ai" }
        expect(yield* Effect.tryPromise(() => app.client.account.get())).toEqual(profile)

        const memberClient = app.clientFor()
        const member = yield* app.login(memberClient, {
          subject: Auth.Sub.make("test-member"),
          email: Auth.Email.make("member@bymorning.ai"),
        })
        expect(yield* Effect.tryPromise(() => memberClient.account.get())).toEqual({
          id: member.properties.accountID,
          email: "member@bymorning.ai",
        })
        expect(yield* Effect.tryPromise(() => app.client.account.get())).toEqual(profile)

        yield* app.process(
          Auth.Service.use((auth) =>
            auth.resolve(
              Auth.Assertion.make({
                provider: Auth.Provider.make("local"),
                subject: Auth.Sub.make("test-owner"),
                verifiedEmail: Auth.Email.make("renamed@bymorning.ai"),
              }),
            ),
          ),
        )
        expect(yield* Effect.tryPromise(() => app.client.account.get())).toEqual({
          ...profile,
          email: "renamed@bymorning.ai",
        })
        yield* app.login()
        expect(yield* Effect.tryPromise(() => app.client.account.get())).toEqual(profile)

        yield* Effect.tryPromise(() => app.client.auth.logout())
        const loggedOut = yield* Effect.tryPromise(() => app.client.account.get()).pipe(Effect.flip)
        expect(loggedOut.cause).toMatchObject({ _tag: "UnauthorizedError" })
        expect(yield* Effect.tryPromise(() => memberClient.account.get())).toEqual({
          id: member.properties.accountID,
          email: "member@bymorning.ai",
        })
      }),
    ),
    { signal },
  )
})
