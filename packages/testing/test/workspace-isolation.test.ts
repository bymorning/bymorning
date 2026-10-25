import { Integration } from "@bymorning/core/integration"
import { Auth } from "@bymorning/schema/auth"
import { Provider } from "@bymorning/schema/provider"
import { Effect } from "effect"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"

// Two Workspaces in one Application: each Workspace's Provider directory,
// Connections, and Provider Activation must be its own, regardless of which
// Workspace activated first in the process.
test("provider connections and activation stay within their own Workspace", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const first = yield* app.login()
      const firstWorkspace = first.properties.workspaceID
      const firstClient = app.client
      // Activate the first Workspace before the second exists, as a process boot does.
      yield* Effect.tryPromise(() => firstClient.provider.list({ workspace: firstWorkspace }))
      yield* Effect.tryPromise(() =>
        firstClient.integration.connect.key({
          workspace: firstWorkspace,
          integrationID: Integration.ID.make("fireworks"),
          key: "first-fireworks-key",
        }),
      )

      // Open provisioning: a new Account's first login provisions its own Workspace.
      const secondClient = app.clientFor()
      const second = yield* app.login(secondClient, {
        subject: Auth.Sub.make("test-member"),
        email: Auth.Email.make("member@bymorning.ai"),
      })
      const secondWorkspace = second.properties.workspaceID
      expect(secondWorkspace).not.toBe(firstWorkspace)

      const entry = (workspace: typeof firstWorkspace, client: typeof firstClient, name: string) =>
        Effect.tryPromise(() => client.provider.list({ workspace })).pipe(
          Effect.map((directory) => directory.find((item) => item.info.name === name)!),
        )

      // The second Workspace must not see the first Workspace's Fireworks Connection.
      const leaked = yield* entry(secondWorkspace, secondClient, "fireworks")
      expect(leaked.connectionCount).toBe(0)
      expect(leaked.connected).toBe(false)

      // A Connection made in the second Workspace is visible there, and only there.
      yield* Effect.tryPromise(() =>
        secondClient.integration.connect.key({
          workspace: secondWorkspace,
          integrationID: Integration.ID.make("anthropic"),
          key: "second-anthropic-key",
        }),
      )
      const own = yield* entry(secondWorkspace, secondClient, "anthropic")
      expect(own.connectionCount).toBe(1)
      expect(own.active).toBe(true)
      expect(
        (yield* Effect.tryPromise(() => secondClient.model.list({ workspace: secondWorkspace, provider: "anthropic" })))
          .length,
      ).toBeGreaterThan(0)
      const other = yield* entry(firstWorkspace, firstClient, "anthropic")
      expect(other.connectionCount).toBe(0)
      expect(other.active).toBe(false)
      expect((yield* entry(firstWorkspace, firstClient, "fireworks")).connectionCount).toBe(1)

      // Provider Activation written in the second Workspace changes only that Workspace.
      yield* Effect.tryPromise(() =>
        secondClient.provider.update({
          workspace: secondWorkspace,
          provider: Provider.Name.make("groq"),
          status: "enabled",
        }),
      )
      expect((yield* entry(secondWorkspace, secondClient, "groq")).info.status).toBe("enabled")
      expect((yield* entry(firstWorkspace, firstClient, "groq")).info.status).toBe("auto")

      // Changing the default Model twice leaves exactly one preferred default, in that Workspace only.
      const models = yield* Effect.tryPromise(() =>
        secondClient.model.list({ workspace: secondWorkspace, provider: "anthropic" }),
      )
      const [before, after] = models.filter((row) => row.enabled && row.unavailableReason === undefined)
      expect(before && after).toBeTruthy()
      const preferred = (workspace: typeof firstWorkspace, client: typeof firstClient) =>
        Effect.tryPromise(() => client.model.list({ workspace })).pipe(
          Effect.map((rows) => rows.filter((row) => row.isPreferredDefault).map((row) => row.info.id)),
        )
      for (const next of [before!, after!]) {
        const returned = yield* Effect.tryPromise(() =>
          secondClient.model.default({ workspace: secondWorkspace, provider: next.info.provider, id: next.info.id }),
        )
        expect(returned.filter((row) => row.isPreferredDefault).map((row) => row.info.id)).toEqual([next.info.id])
        expect(yield* preferred(secondWorkspace, secondClient)).toEqual([next.info.id])
      }
      expect(yield* preferred(firstWorkspace, firstClient)).toEqual([])
    }).pipe(Effect.scoped),
    { signal },
  )
}, 120_000)

// The Workspace middleware is the tenant boundary: an authenticated Account that is not a member of a
// Workspace must be refused when it selects that Workspace, on every Workspace-scoped group.
test("an Account that is not a member cannot read another Workspace's Commands or References", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const first = yield* app.login()
      const firstWorkspace = first.properties.workspaceID
      const outsiderClient = app.clientFor()
      const outsider = yield* app.login(outsiderClient, {
        subject: Auth.Sub.make("test-member"),
        email: Auth.Email.make("member@bymorning.ai"),
      })
      expect(outsider.properties.workspaceID).not.toBe(firstWorkspace)

      // Members can read their own Workspace's lists...
      yield* Effect.tryPromise(() => app.client.command.list({ workspace: firstWorkspace }))
      yield* Effect.tryPromise(() => app.client.reference.list({ workspace: firstWorkspace }))
      // ...and the outsider is refused the other Workspace's.
      const command = yield* Effect.tryPromise(() => outsiderClient.command.list({ workspace: firstWorkspace })).pipe(
        Effect.flip,
      )
      const reference = yield* Effect.tryPromise(() =>
        outsiderClient.reference.list({ workspace: firstWorkspace }),
      ).pipe(Effect.flip)
      for (const error of [command, reference]) expect(error.cause).toMatchObject({ _tag: "UnauthorizedError" })
    }).pipe(Effect.scoped),
    { signal },
  )
})
