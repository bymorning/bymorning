import type { ByMorningClient } from "@bymorning/client"
import { Auth } from "@bymorning/schema/auth"
import { Integration } from "@bymorning/schema/integration"
import type { Workspace } from "@bymorning/schema/workspace"
import { Effect, Stream } from "effect"
import { expect, test } from "vitest"
import { Mcp } from "@bymorning/core/mcp"
import { TestApp } from "../src/application.js"
import { TestUpstream } from "../src/upstream.js"

const call = <A>(run: () => Promise<A>) => Effect.tryPromise(run)

/** Read one member's server status once it has settled, synchronizing on that member's status events. */
const settled = (client: ByMorningClient, workspace: Workspace.ID, server: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const changes = yield* Stream.fromAsyncIterable(
        client.event.subscribe({ workspace }),
        (cause) => new TestApp.RequestError({ message: "Workspace Event stream failed", cause }),
      ).pipe(
        Stream.filter((event) => event.type === "mcp.status.changed"),
        Stream.toPull,
      )
      while (true) {
        const status = (yield* call(() => client.mcp.servers.list({ workspace }))).find((item) => item.name === server)
        if (status !== undefined && status.status !== "pending") return status
        yield* changes
      }
    }),
  )

test("each member authenticates a header-based MCP server with their own values", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const upstream = yield* TestUpstream.make()
      const app = yield* TestApp.make()
      const owner = yield* app.login()
      const workspace = owner.properties.workspaceID
      yield* call(() => app.client.user.invite({ email: Auth.Email.make("member@bymorning.ai"), role: "member" }))
      const memberClient = app.clientFor()
      const member = yield* app.login(memberClient, {
        subject: Auth.Sub.make("test-member"),
        email: Auth.Email.make("member@bymorning.ai"),
      })

      // The upstream accepts only `Bearer access-2`; each member supplies their own token.
      yield* call(() =>
        app.client.mcp.servers.put({
          workspace,
          server: "river",
          url: upstream.url.href,
          oauth: false,
          codemode: false,
          headers: { authorization: "Bearer ${TOKEN}", "x-user": "${member.email}" },
        }),
      )
      const integrationID = Integration.ID.make(Mcp.identity("river", upstream.url.href))
      for (const client of [app.client, memberClient])
        expect(yield* settled(client, workspace, "river")).toMatchObject({
          status: "needs_auth",
          auth: "values",
          integrationID,
        })

      // A value the server refuses is reported, and stays replaceable.
      yield* call(() => app.client.integration.connect.values({ workspace, integrationID, values: { TOKEN: "wrong" } }))
      yield* call(() => app.client.mcp.servers.connect({ workspace, server: "river" }))
      expect(yield* settled(app.client, workspace, "river")).toMatchObject({
        status: "failed",
        error: "Server rejected your values",
      })

      yield* call(() => app.client.integration.connect.values({ workspace, integrationID, values: { TOKEN: "access-2" } }))
      yield* call(() => app.client.mcp.servers.connect({ workspace, server: "river" }))
      expect(yield* settled(app.client, workspace, "river")).toMatchObject({ status: "connected", auth: "values" })
      expect((yield* call(() => app.client.mcp.tools.list({ workspace }))).map((tool) => tool.server)).toContain("river")

      // The owner's values never reach the member: the member still has to authenticate.
      expect(yield* settled(memberClient, workspace, "river")).toMatchObject({ status: "needs_auth" })
      expect((yield* call(() => memberClient.mcp.tools.list({ workspace }))).map((tool) => tool.server)).not.toContain(
        "river",
      )

      // Saved names are visible to their owner; values never are.
      const info = yield* call(() => app.client.integration.get({ workspace, integrationID }))
      expect(info?.methods).toEqual([{ type: "values", label: "Member values", fields: ["TOKEN"], saved: ["TOKEN"] }])
      expect(JSON.stringify(info)).not.toContain("access-2")
      const memberInfo = yield* call(() => memberClient.integration.get({ workspace, integrationID }))
      expect(memberInfo?.methods).toEqual([{ type: "values", label: "Member values", fields: ["TOKEN"], saved: [] }])

      // Moving the server discards values entrusted to the previous address.
      const moved = yield* TestUpstream.make()
      yield* call(() =>
        app.client.mcp.servers.put({
          workspace,
          server: "river",
          url: moved.url.href,
          oauth: false,
          codemode: false,
          headers: { authorization: "Bearer ${TOKEN}" },
        }),
      )
      expect(yield* settled(app.client, workspace, "river")).toMatchObject({ status: "needs_auth" })
      // Moving back does not resurrect them: the owner must supply values again.
      yield* call(() =>
        app.client.mcp.servers.put({
          workspace,
          server: "river",
          url: upstream.url.href,
          oauth: false,
          codemode: false,
          headers: { authorization: "Bearer ${TOKEN}" },
        }),
      )
      expect(yield* settled(app.client, workspace, "river")).toMatchObject({ status: "needs_auth", integrationID })
      const restored = yield* call(() => app.client.integration.get({ workspace, integrationID }))
      expect(restored?.connections).toEqual([])
      expect(restored?.methods).toEqual([{ type: "values", label: "Member values", fields: ["TOKEN"], saved: [] }])
      expect(member.properties.workspaceID).toBe(workspace)
    }).pipe(Effect.scoped),
    { signal },
  )
})
