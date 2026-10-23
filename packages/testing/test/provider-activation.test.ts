import { Provider } from "@bymorning/schema/provider"
import { Auth } from "@bymorning/schema/auth"
import { Effect } from "effect"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"

test("refuses unauthenticated Provider activation", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      yield* Effect.promise(() =>
        expect(
          app.client.provider.update({ provider: Provider.AmazonBedrock, status: "enabled" }),
        ).rejects.toBeDefined(),
      )
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("persists explicit Provider activation through the generated SDK", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      yield* app.login()

      const unknown = yield* Effect.tryPromise(() =>
        app.client.provider.update({ provider: Provider.Name.make("missing-provider"), status: "enabled" }),
      ).pipe(Effect.flip)
      expect(unknown.cause).toMatchObject({ _tag: "Protocol.InputError", error: "Provider was not found" })

      const initial = yield* Effect.promise(() => app.client.provider.list())
      const bedrock = initial.find((entry) => entry.info.name === Provider.AmazonBedrock)
      expect(bedrock).toMatchObject({ info: { status: "auto" }, active: false, connected: false })
      const inactiveModels = yield* Effect.promise(() =>
        app.client.model.list({ provider: Provider.AmazonBedrock }),
      )
      expect(inactiveModels.length).toBeGreaterThan(0)
      expect(inactiveModels.every((model) => model.unavailableReason === "provider-inactive")).toBe(true)

      const enabled = yield* Effect.promise(() =>
        app.client.provider.update({ provider: Provider.AmazonBedrock, status: "enabled" }),
      )
      expect(enabled.status).toBe("enabled")
      expect((yield* Effect.promise(() => app.client.provider.list())).find((entry) => entry.info.name === Provider.AmazonBedrock)).toMatchObject({
        info: { status: "enabled" },
        active: true,
        connected: true,
      })

      yield* Effect.promise(() => app.client.provider.update({ provider: Provider.AmazonBedrock, status: "disabled" }))
      expect((yield* Effect.promise(() => app.client.provider.list())).find((entry) => entry.info.name === Provider.AmazonBedrock)).toMatchObject({
        info: { status: "disabled" },
        active: false,
        connected: false,
      })

      yield* Effect.promise(() => app.client.provider.update({ provider: Provider.AmazonBedrock, status: "auto" }))
      expect((yield* Effect.promise(() => app.client.provider.list())).find((entry) => entry.info.name === Provider.AmazonBedrock)).toMatchObject({
        info: { status: "auto" },
        active: false,
        connected: false,
      })
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("refuses Provider activation from a Workspace member", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const admin = yield* app.login()
      const email = Auth.Email.make("provider-member@bymorning.ai")
      yield* Effect.promise(() => app.client.user.invite({ email, role: "member" }))
      const memberClient = app.clientFor()
      yield* app.login(memberClient, { subject: Auth.Sub.make("provider-member"), email })

      const denied = yield* Effect.tryPromise(() =>
        memberClient.provider.update({ provider: Provider.AmazonBedrock, status: "enabled" }),
      ).pipe(Effect.flip)
      expect(denied.cause).toMatchObject({ _tag: "ForbiddenError" })
      const workspace = admin.properties.workspaceID
      const memberConfig = yield* Effect.promise(() => memberClient["api.config"].get({ workspace }))
      const bypass = yield* Effect.tryPromise(() =>
        memberClient["api.config"].update({
          ...memberConfig,
          workspace,
          providers: {
            ...memberConfig.providers,
            activation: { ...memberConfig.providers?.activation, [Provider.AmazonBedrock]: "enabled" },
          },
        }),
      ).pipe(Effect.flip)
      expect(bypass.cause).toMatchObject({ _tag: "ForbiddenError" })
      expect(
        (yield* Effect.promise(() => app.client.provider.list())).find(
          (entry) => entry.info.name === Provider.AmazonBedrock,
        ),
      ).toMatchObject({ info: { status: "auto" }, active: false })
    }).pipe(Effect.scoped),
    { signal },
  )
})
