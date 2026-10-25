import { AuthProvider as AuthProviderSchema } from "@bymorning/schema/auth-provider"
import { Effect } from "effect"
import { createServer } from "node:net"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { AuthScenario } from "../src/scenario/auth.js"

test("answers Setup 503 naming the unreachable issuer origin", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      // A loopback port with no listener stands in for an issuer the Gateway cannot reach.
      const port = yield* Effect.promise(
        () =>
          new Promise<number>((resolve, reject) => {
            const server = createServer()
            server.once("error", reject)
            server.listen(0, "127.0.0.1", () => {
              const address = server.address()
              server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject()))
            })
          }),
      )
      const origin = `http://127.0.0.1:${port}`
      const message = `ByMorning could not reach the identity provider at ${origin}. Check that the Gateway has outbound HTTPS access to it.`
      const app = yield* TestApp.make()
      const token = yield* AuthScenario.setupToken(app)
      const payload = {
        type: "create",
        token,
        value: {
          id: AuthProviderSchema.ID.create(),
          displayName: "Microsoft Entra",
          kind: "microsoft",
          domains: ["example.gov"],
          issuer: `${origin}/tenant/v2.0`,
          clientID: "client",
          clientSecret: "secret",
        },
      } as const

      const response = yield* Effect.tryPromise(() =>
        fetch(new URL("/auth/setup", app.origin), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, value: { ...payload.value, id: AuthProviderSchema.ID.create() } }),
        }),
      )
      expect(response.status).toBe(503)
      expect(yield* Effect.promise(() => response.json())).toEqual({ _tag: "ServiceUnavailableError", message })

      // The generated SDK surfaces the same message the Setup page renders.
      const failure = yield* Effect.tryPromise(() => app.client.auth.setup({ payload })).pipe(Effect.flip)
      expect(failure.cause).toMatchObject({ _tag: "ServiceUnavailableError", message })
      const inspected = yield* Effect.tryPromise(() => app.client.auth.inspect({ token }))
      expect(inspected).toEqual([])
    }).pipe(Effect.scoped),
    { signal },
  )
}, 60_000)
