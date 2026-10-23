import { NodeCrypto, NodeHttpServer } from "@effect/platform-node"
import { Database, UserTable } from "@bymorning/core/database"
import { Audit } from "@bymorning/core/audit"
import { AuthProvider } from "@bymorning/core/auth-provider"
import { Cipher } from "@bymorning/core/cipher"
import { Storage } from "@bymorning/core/storage"
import { AuthSchema } from "@bymorning/schema/auth"
import { ApiKey } from "@bymorning/schema/api-key"
import { Info } from "@bymorning/schema/service-account"
import { ConfigProvider, Effect, Layer, ManagedRuntime, Redacted, Schema } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { createServer, request } from "node:http"
import { describe, expect, it } from "vitest"
import { postgres } from "../../test/postgres.js"
import { start } from "../../test/oidc-idp.js"
import { Application } from "../application.js"
import { CodeInterpreter } from "@bymorning/core/code-interpreter"
import { makeGlobalNode } from "@bymorning/util/effect/app-node"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { WebCookie } from "../web-cookie.js"
import { WebProvider } from "../web-provider.js"

const appOrigin = "http://localhost:3000"
const ServiceAccountResponse = Schema.Struct({
  ...Info.fields,
  timeCreated: Schema.DateFromString,
  timeUpdated: Schema.DateFromString,
})
const ServiceAccountSummaryResponse = Schema.Struct({
  ...ServiceAccountResponse.fields,
  keyCount: Schema.Int,
})
const ApiKeyResponse = Schema.Struct({
  ...ApiKey.Info.fields,
  timeExpires: Schema.optionalKey(Schema.DateFromString),
  timeUsed: Schema.optionalKey(Schema.DateFromString),
  timeCreated: Schema.DateFromString,
  timeRevoked: Schema.optionalKey(Schema.DateFromString),
})
const database = postgres()
const storage = Storage.layer({
  configure: (draft) => {
    draft.add(Storage.memory())
    draft.default.set(Storage.ID.make("memory"))
  },
})
const cookie = WebCookie.defaultLayer.pipe(
  Layer.provide(
    ConfigProvider.layer(ConfigProvider.fromUnknown({ WEB_COOKIE_KEY: Buffer.alloc(32, 19).toString("base64url") })),
  ),
  Layer.orDie,
)
const provider = Layer.effect(
  WebProvider.Service,
  Effect.gen(function* () {
    return WebProvider.Service.of({
      start: () =>
        Effect.succeed({
          redirect: new URL("https://issuer.example/authorize"),
          provider: AuthSchema.Provider.make("service-account-test"),
          state: Redacted.make("controlled-state"),
          verifier: Redacted.make("controlled-verifier"),
        }),
      complete: (input) => {
        if (
          Redacted.value(input.code) !== "controlled-code" ||
          Redacted.value(input.verifier) !== "controlled-verifier" ||
          input.redirectURI.href !== `${appOrigin}/auth/callback`
        )
          return Effect.fail(new WebProvider.ProviderError({ operation: "complete", reason: "exchange" }))
        return Effect.succeed(
          AuthSchema.Assertion.make({
            provider: AuthSchema.Provider.make("service-account-test"),
            subject: AuthSchema.Sub.make("service-account-owner"),
            verifiedEmail: AuthSchema.Email.make("service-account-owner@bymorning.ai"),
          }),
        )
      },
    })
  }),
)
const databaseNode = makeGlobalNode({
  service: Database.Service,
  layer: Layer.effect(Database.Service, Effect.service(Database.Service)).pipe(Layer.provide(database)),
  deps: [],
})
const storageNode = makeGlobalNode({ service: Storage.Service, layer: storage, deps: [] })
const cipherBackend = (fill: number): Cipher.Backend =>
  Effect.runSync(
    Cipher.localBackend(Redacted.make(Buffer.alloc(32, fill).toString("base64url"))).pipe(
      Effect.provide(NodeCrypto.layer),
    ),
  )
const cipherNode = Cipher.configured(cipherBackend(31))
const support = LayerNode.compile(
  LayerNode.group([
    Application.node({
      settings: {
        appOrigin: new URL(appOrigin),
        host: "127.0.0.1",
        port: 3210,
        allowedEmailDomains: ["bymorning.ai"],
        cookiePolicy: WebCookie.secure,
        cipher: cipherBackend(19),
      },
      deps: {
        database: databaseNode,
        storage: storageNode,
        identity: makeGlobalNode({ service: WebProvider.Service, layer: provider, deps: [] }),
        cookie: makeGlobalNode({ service: WebCookie.Service, layer: cookie, deps: [] }),
      },
    }),
    databaseNode,
    Database.node,
    AuthProvider.node,
  ]),
  {
    replacements: [
      Database.node.replace(databaseNode),
      Audit.node.replace(Audit.makeNode({ database: databaseNode })),
      Cipher.node.replace(cipherNode),
    ],
  },
)

const responseHeaders = (response: import("node:http").IncomingMessage) => {
  const headers = new Headers()
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    const name = response.rawHeaders[index]
    const value = response.rawHeaders[index + 1]
    if (name !== undefined && value !== undefined) headers.append(name, value)
  }
  return headers
}

const login = (baseURL: string, path = "/auth/login"): Promise<Headers> =>
  new Promise((resolve, reject) => {
    const clientRequest = request(new URL(path, baseURL), { headers: { host: "localhost:3000" } })
    clientRequest.on("response", (response) => {
      response.resume()
      response.on("end", () => resolve(responseHeaders(response)))
    })
    clientRequest.on("error", reject)
    clientRequest.end()
  })

const cookiePair = (headers: Headers, name: string) => {
  const value = headers.getSetCookie().findLast((cookie) => cookie.startsWith(`${name}=`))
  if (value === undefined) throw new Error(`Missing ${name} cookie`)
  const pair = value.split(";", 1)[0]
  if (pair === undefined) throw new Error(`Invalid ${name} cookie`)
  return pair
}

describe("ServiceAccount HTTP handlers", () => {
  it("manages a service account and its inference API key in Postgres", async () => {
    const fixture = await start()
    const live = HttpRouter.serve(support, { disableListenLog: true, disableLogger: true }).pipe(
      Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: 0 })),
    )
    const application = ManagedRuntime.make(live)
    try {
      const server = await application.runPromise(HttpServer.HttpServer)
      const baseURL = HttpServer.formatAddress(server.address).replace("0.0.0.0", "127.0.0.1")
      const info = await application.runPromise(
        AuthProvider.Service.use((providers) =>
          providers.create(
            Schema.decodeUnknownSync(AuthProvider.Create)({
              id: AuthProvider.ID.create(),
              displayName: "Service account OIDC",
              kind: "custom",
              issuer: fixture.issuer.href,
              clientID: fixture.clientID,
              clientSecret: fixture.clientSecret,
              domains: ["bymorning.ai"],
            }),
          ),
        ),
      )
      const started = await login(baseURL, `/auth/login?provider=${info.id}`)
      const attempt = cookiePair(started, "__Secure-bm_auth_attempt_v1")
      const issued = await fixture.authorize(
        new URL(started.get("location") ?? "invalid:"),
        {
          sub: "service-account-owner",
          email: "service-account-owner@bymorning.ai",
          extra: { email_verified: true },
        },
      )
      const callback = await fetch(new URL(`${issued.redirect.pathname}${issued.redirect.search}`, baseURL), {
        redirect: "manual",
        headers: { cookie: attempt },
      })
      expect(callback.status).toBe(303)
      const authenticated = {
        cookie: cookiePair(callback.headers, "__Host-bm_auth"),
        origin: appOrigin,
        "content-type": "application/json",
      }
      const [membership] = await application.runPromise(
        Database.Service.use((database) =>
          database.use("ServiceAccountHandlerTest.user", (db) => db.select().from(UserTable)),
        ),
      )
      if (membership === undefined) throw new Error("Expected provisioned Workspace membership")
      const endpoint = `${baseURL}/api/service-account?workspace=${membership.workspaceId}`

      const created = await fetch(endpoint, {
        method: "POST",
        headers: authenticated,
        body: JSON.stringify({ name: "CI gateway", policy: { models: ["claude-sonnet"], rpm: 10 } }),
      })
      expect(created.status).toBe(201)
      const account = Schema.decodeUnknownSync(ServiceAccountResponse)(await created.json())
      expect(account).toMatchObject({
        name: "CI gateway",
        status: "active",
        policy: { models: ["claude-sonnet"], rpm: 10 },
      })

      const listed = await fetch(endpoint, { headers: authenticated })
      expect(listed.status).toBe(200)
      expect(Schema.decodeUnknownSync(Schema.Array(ServiceAccountSummaryResponse))(await listed.json())).toEqual([
        { ...account, keyCount: 0 },
      ])

      const get = await fetch(`${baseURL}/api/service-account/${account.id}?workspace=${membership.workspaceId}`, {
        headers: authenticated,
      })
      expect(get.status).toBe(200)
      expect(Schema.decodeUnknownSync(ServiceAccountResponse)(await get.json())).toEqual(account)

      const updated = await fetch(`${baseURL}/api/service-account/${account.id}?workspace=${membership.workspaceId}`, {
        method: "PATCH",
        headers: authenticated,
        body: JSON.stringify({ status: "suspended" }),
      })
      expect(updated.status).toBe(200)
      const updatedAccount = Schema.decodeUnknownSync(ServiceAccountResponse)(await updated.json())
      expect(updatedAccount).toMatchObject({ id: account.id, status: "suspended" })

      const keyCreated = await fetch(
        `${baseURL}/api/service-account/${account.id}/key?workspace=${membership.workspaceId}`,
        { method: "POST", headers: authenticated, body: JSON.stringify({ name: "Production" }) },
      )
      expect(keyCreated.status).toBe(201)
      const credential = Schema.decodeUnknownSync(Schema.Struct({ key: ApiKeyResponse, secret: ApiKey.Secret }))(
        await keyCreated.json(),
      )
      expect(credential.secret).toMatch(/^bm_[A-Za-z0-9_-]{43}$/)
      expect(credential.key.prefix).toBe(credential.secret.slice(0, 12))

      const listedWithKey = await fetch(endpoint, { headers: authenticated })
      expect(Schema.decodeUnknownSync(Schema.Array(ServiceAccountSummaryResponse))(await listedWithKey.json())).toEqual(
        [{ ...updatedAccount, keyCount: 1 }],
      )

      const keys = await fetch(`${baseURL}/api/service-account/${account.id}/key?workspace=${membership.workspaceId}`, {
        headers: authenticated,
      })
      expect(keys.status).toBe(200)
      expect(Schema.decodeUnknownSync(Schema.Array(ApiKeyResponse))(await keys.json())).toEqual([credential.key])

      const revoked = await fetch(
        `${baseURL}/api/service-account/${account.id}/key/${credential.key.id}?workspace=${membership.workspaceId}`,
        { method: "DELETE", headers: authenticated },
      )
      expect(revoked.status).toBe(204)

      const removed = await fetch(`${baseURL}/api/service-account/${account.id}?workspace=${membership.workspaceId}`, {
        method: "DELETE",
        headers: authenticated,
      })
      expect(removed.status).toBe(204)

      const missing = await fetch(`${baseURL}/api/service-account/${account.id}?workspace=${membership.workspaceId}`, {
        headers: authenticated,
      })
      expect(missing.status).toBe(404)
      expect(await missing.json()).toEqual({
        _tag: "ServiceAccount.NotFoundError",
        id: account.id,
        message: `Service account resource not found: ${account.id}`,
      })
    } finally {
      await application.dispose()
      await fixture.close()
    }
  }, 60_000)
})
