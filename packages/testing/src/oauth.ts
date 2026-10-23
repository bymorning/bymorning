/** Local external OAuth protocol and authenticated HTTP leaf, owned by the test scope. */
export * as TestOAuth from "./oauth.js"

import { Plugin } from "@bymorning/plugin"
import { Credential } from "@bymorning/schema/credential"
import { Integration } from "@bymorning/schema/integration"
import { Effect, Schema } from "effect"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { TestHTTP } from "./http.js"

export const integrationID = Integration.ID.make("fixture.oauth")
export const methodID = Integration.MethodID.make("local")

const Token = Schema.Struct({ access_token: Schema.String, refresh_token: Schema.String, expires_in: Schema.Finite })

/** The same module is a normal persisted Promise plugin entrypoint. */
export default Plugin.define({
  id: "test.tool-auth",
  async setup(context) {
    const origin = new URL(Schema.decodeUnknownSync(Schema.String)(context.options.endpoint))
    const noRefresh = (context.options as { readonly noRefresh?: unknown }).noRefresh === true
    if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1") throw new Error("Expected local OAuth issuer")
    const exchange = async (body: URLSearchParams): Promise<Credential.OAuth> => {
      const response = await fetch(new URL("/token", origin), { method: "POST", body, redirect: "error" })
      if (!response.ok) throw new Error("OAuth exchange failed")
      const token = Schema.decodeUnknownSync(Token)(await response.json())
      return Credential.OAuth.make({ type: "oauth", methodID, access: token.access_token,
        refresh: token.refresh_token, expires: Date.now() + token.expires_in * 1000 })
    }
    await context.integration.transform((editor) => {
      editor.update(integrationID, (integration) => {
        integration.name = "Local member OAuth"
        integration.connectionPolicy = "member-only"
      })
      editor.method.update({
        integrationID,
        method: { id: methodID, type: "oauth", label: "Local OAuth" },
        async authorize() {
          const callback = await context.integration.oauth.callback.register()
          const url = new URL("/authorize", origin)
          url.search = new URLSearchParams({ response_type: "code", client_id: "fixture",
            state: callback.state, redirect_uri: callback.callbackURI }).toString()
          return { mode: "auto", url: url.href, instructions: "Authorize the local account", callback: callback.wait.then((result) => {
            if (!("code" in result)) throw new Error("OAuth authorization denied")
            return exchange(new URLSearchParams({ grant_type: "authorization_code", code: result.code,
              client_id: "fixture", redirect_uri: callback.callbackURI }))
          }) }
        },
        ...(noRefresh ? {} : { refresh: (credential) => exchange(new URLSearchParams({ grant_type: "refresh_token", refresh_token: credential.refresh })) }),
      })
    })
    await context.tool.transform((editor) => {
      for (const codemode of [false, true]) editor.add({
        name: codemode ? "member_code" : "member_http",
        description: "Read the invoking member's local external account",
        input: Schema.Struct({}), output: Schema.String,
        options: { codemode, permission: "fixture.member" },
        async execute(_input, invocation) {
          const connection = await context.integration.connection.active(integrationID)
          if (!connection) throw new Error("Member connection required")
          const credential = await context.integration.connection.resolve(connection)
          if (credential?.type !== "oauth") throw new Error("Member connection unavailable")
          await invocation.permission({ action: "fixture.member", resources: [origin.origin] })
          const response = await fetch(new URL("/account", origin), {
            headers: { authorization: `Bearer ${credential.access}` }, redirect: "error",
          })
          if (!response.ok) throw new Error("Account request refused")
          const output = await response.text()
          return { output, content: output }
        },
      })
    })
  },
})

export const make = () => Effect.gen(function* () {
  type Grant = { member: string; generation: number }
  const authorization = new Map<string, string>()
  const codes = new Map<string, { member: string; redirect: string }>()
  const access = new Map<string, Grant>()
  const refresh = new Map<string, Grant>()
  const calls: Grant[] = []
  const exchanges: Array<Grant & { grant: string }> = []
  const failures: unknown[] = []
  const http = yield* TestHTTP.make((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://localhost")
      if (url.pathname === "/authorize") {
        const state = url.searchParams.get("state") ?? ""
        const member = authorization.get(state)
        assert.ok(member, "Authorization must be explicitly bound to this attempt's state")
        authorization.delete(state)
        assert.equal(url.searchParams.get("response_type"), "code")
        assert.equal(url.searchParams.get("client_id"), "fixture")
        const redirect = url.searchParams.get("redirect_uri")
        assert.ok(redirect)
        const code = randomBytes(24).toString("base64url")
        codes.set(code, { member, redirect })
        const callback = new URL(redirect)
        callback.search = new URLSearchParams({ state, code }).toString()
        response.writeHead(302, { location: callback.href }).end()
        return
      }
      if (url.pathname === "/token") {
        assert.equal(request.method, "POST")
        let body = ""
        for await (const chunk of request) body += chunk
        const form = new URLSearchParams(body)
        const grant = form.get("grant_type")
        let next: Grant
        if (grant === "authorization_code") {
          const code = form.get("code") ?? ""
          const approved = codes.get(code)
          assert.ok(approved, "Authorization code must be one-use and issued by this server")
          assert.equal(form.get("redirect_uri"), approved.redirect)
          assert.equal(form.get("client_id"), "fixture")
          codes.delete(code)
          next = { member: approved.member, generation: 1 }
        } else {
          assert.equal(grant, "refresh_token")
          const previous = refresh.get(form.get("refresh_token") ?? "")
          assert.ok(previous, "Refresh must use the token issued for that authorization")
          refresh.delete(form.get("refresh_token") ?? "")
          next = { member: previous.member, generation: previous.generation + 1 }
        }
        const accessToken = randomBytes(32).toString("base64url")
        const refreshToken = randomBytes(32).toString("base64url")
        access.set(accessToken, next)
        refresh.set(refreshToken, next)
        exchanges.push({ ...next, grant: grant! })
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
          access_token: accessToken, refresh_token: refreshToken, expires_in: 3600, token_type: "Bearer",
        }))
        return
      }
      if (url.pathname === "/account") {
        const identity = access.get(request.headers.authorization?.replace(/^Bearer /, "") ?? "")
        if (!identity) { response.writeHead(401).end(); return }
        calls.push(identity)
        response.writeHead(200, { "content-type": "text/plain" }).end(`${identity.member}:generation-${identity.generation}`)
        return
      }
      response.writeHead(404).end()
    })().catch((error) => { failures.push(error); response.writeHead(500).end("Protocol assertion failed") })
  })
  yield* Effect.addFinalizer(() => Effect.sync(() => assert.equal(failures.length, 0, "OAuth protocol assertions failed")))
  return {
    origin: http.origin,
    /** Models the external login choice for one exact authorization URL, never a global current identity. */
    bind: (url: string, member: string) => {
      const state = new URL(url).searchParams.get("state")
      assert.ok(state)
      assert.equal(authorization.has(state), false)
      authorization.set(state, member)
    },
    calls: () => [...calls],
    exchanges: () => [...exchanges],
    sensitive: () => http.requests().filter((request) => request.url === "/account").length,
  }
})
