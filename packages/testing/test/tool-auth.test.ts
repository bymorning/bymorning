import { Cipher } from "@bymorning/core/cipher"
import { Effect } from "effect"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { TestOAuth } from "../src/oauth.js"
import { ToolAuth } from "../src/scenario/tool-auth.js"

test("real member OAuth stays isolated through direct/CodeMode Tools, refresh and revocation", async ({ signal }) => {
  await Effect.runPromise(Effect.gen(function* () {
    const issuer = yield* TestOAuth.make()
    const app = yield* TestApp.make({ plugins: [ToolAuth.plugin(issuer.origin)] })
    const data = yield* ToolAuth.make(app, issuer)
    for (const mode of ["direct", "code"] as const) {
      for (const [mcp, member] of [[data.ownerMCP, "owner"], [data.memberMCP, "member"]] as const) {
        const result = yield* ToolAuth.call(mcp, mode)
        expect(result.isError).not.toBe(true)
        expect(JSON.stringify(result.content), `${member} ${mode} must use the invoking member's Connection`).toContain(`${member}:generation-1`)
      }
    }
    expect(issuer.calls()).toEqual([
      { member: "owner", generation: 1 }, { member: "member", generation: 1 },
      { member: "owner", generation: 1 }, { member: "member", generation: 1 },
    ])
    expect(issuer.exchanges()).toEqual([
      { member: "owner", generation: 1, grant: "authorization_code" },
      { member: "member", generation: 1, grant: "authorization_code" },
    ])

    yield* ToolAuth.expire(app, data.member, data.memberConnection.id)
    for (const mode of ["code", "direct"] as const) {
      const refreshed = yield* ToolAuth.call(data.memberMCP, mode)
      expect(refreshed.isError).not.toBe(true)
      expect(JSON.stringify(refreshed.content)).toContain("member:generation-2")
      const unaffected = yield* ToolAuth.call(data.ownerMCP, mode)
      expect(unaffected.isError).not.toBe(true)
      expect(JSON.stringify(unaffected.content)).toContain("owner:generation-1")
    }
    expect(issuer.exchanges().filter((exchange) => exchange.grant === "refresh_token")).toEqual([
      { member: "member", generation: 2, grant: "refresh_token" },
    ])
    const refreshed = yield* Effect.tryPromise(() => data.client.integration.get({ integrationID: TestOAuth.integrationID }))
    expect(refreshed?.connections.map((connection) => "id" in connection ? connection.id : undefined)).toEqual([data.memberConnection.id])

    yield* ToolAuth.shared(app, data.owner, data.ownerConnection.id)
    yield* Effect.tryPromise(() => data.client.credential.remove({ credentialID: data.memberConnection.id }))
    const revoked = yield* Effect.tryPromise(() => data.client.integration.get({ integrationID: TestOAuth.integrationID }))
    expect(revoked?.connections).toEqual([])
    const before = issuer.sensitive()
    for (const mode of ["direct", "code"] as const) {
      const denied = yield* ToolAuth.call(data.memberMCP, mode)
      if (mode === "direct") expect(denied.isError).toBe(true)
      else {
        // CodeMode reports a failed leaf in its typed execution result rather
        // than failing the outer execute Tool's MCP transport envelope.
        expect(denied.structuredContent?.error).toBe(true)
        expect(denied.structuredContent?.toolCalls).toEqual([{ tool: "member_code", status: "error" }])
      }
      expect(JSON.stringify(denied.content)).toContain("Member connection required")
      expect(JSON.stringify(denied.content)).not.toContain("owner:generation")
      expect(issuer.sensitive()).toBe(before)
    }
    for (const mode of ["direct", "code"] as const) {
      const unaffected = yield* ToolAuth.call(data.ownerMCP, mode)
      expect(unaffected.isError).not.toBe(true)
      expect(JSON.stringify(unaffected.content)).toContain("owner:generation-1")
    }
    expect(issuer.sensitive()).toBe(before + 2)
    expect(issuer.exchanges()).toHaveLength(3)
  }).pipe(Effect.scoped), { signal })
}, 90_000)

test("a member OAuth refresh after Gateway restarts is saved", async ({ signal }) => {
  await Effect.runPromise(Effect.gen(function* () {
    const issuer = yield* TestOAuth.make()
    const app = yield* TestApp.make({ plugins: [ToolAuth.plugin(issuer.origin)] })
    const data = yield* ToolAuth.make(app, issuer)
    yield* ToolAuth.expire(app, data.member, data.memberConnection.id)
    // Two restarts, each running the same boot migrator the Gateway runs at startup.
    yield* app.process(Cipher.migrate)
    yield* app.process(Cipher.migrate)

    const refreshed = yield* ToolAuth.call(data.memberMCP, "direct")
    expect(refreshed.isError).not.toBe(true)
    expect(JSON.stringify(refreshed.content)).toContain("member:generation-2")
    // The rotated token was persisted: it is no longer expired and is reused without another exchange.
    expect(yield* ToolAuth.expiry(app, data.member, data.memberConnection.id)).toBeGreaterThan(1)
    const reused = yield* ToolAuth.call(data.memberMCP, "code")
    expect(reused.isError).not.toBe(true)
    expect(JSON.stringify(reused.content)).toContain("member:generation-2")
    expect(issuer.exchanges().filter((exchange) => exchange.grant === "refresh_token")).toEqual([
      { member: "member", generation: 2, grant: "refresh_token" },
    ])
  }).pipe(Effect.scoped), { signal })
}, 90_000)
