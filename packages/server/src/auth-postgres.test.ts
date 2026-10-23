import { NodeCrypto, NodeHttpServer } from "@effect/platform-node"
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { Account } from "@bymorning/core/account"
import { Auth } from "@bymorning/core/auth"
import { Audit } from "@bymorning/core/audit"
import { AuthProvider } from "@bymorning/core/auth-provider"
import { Cipher } from "@bymorning/core/cipher"
import { Storage } from "@bymorning/core/storage"
import { ProjectStorage } from "@bymorning/core/project-storage"
import { IntegrationOAuthCallback } from "@bymorning/core/integration-oauth-callback"
import {
  AccountTable,
  AgentTable,
  AuthTable,
  ConfigTable,
  Database,
  ProjectTable,
  OAuthGrantTable,
  SessionTable,
  UserTable,
  WorkspaceTable,
} from "@bymorning/core/database"
import { User } from "@bymorning/core/user"
import { Workspace } from "@bymorning/core/workspace"
import { OAuth } from "@bymorning/core/oauth"
import { AuthSchema } from "@bymorning/schema/auth"
import { AgentSchema } from "@bymorning/schema/agent"
import { ConfigSchema } from "@bymorning/schema/config"
import { InstructionEntrySchema } from "@bymorning/schema/instruction-entry"
import { Integration } from "@bymorning/schema/integration"
import { SessionSchema } from "@bymorning/schema/session"
import { SkillSchema } from "@bymorning/schema/skill"
import { ProjectSchema } from "@bymorning/schema/project"
import { UserSchema } from "@bymorning/schema/user"
import { WorkspaceSchema } from "@bymorning/schema/workspace"
import { AccountSchema } from "@bymorning/schema/account"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { DateTime, Effect, Layer, ManagedRuntime, Option, Redacted, Schema, Stream } from "effect"
import { eq } from "drizzle-orm"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { createServer, request } from "node:http"
import { describe, expect, it } from "vitest"
import { postgres } from "../test/postgres.js"
import { start } from "../test/oidc-idp.js"
import { WebCookie } from "./web-cookie.js"
import { WebProvider } from "./web-provider.js"
import { WorkspaceMap } from "./workspace-map.js"
import { Application } from "./application.js"
import { makeGlobalNode } from "@bymorning/util/effect/app-node"
const appOrigin = "http://localhost:3000"
const defaultConfig = Schema.decodeUnknownSync(ConfigSchema.Info)({})
const database = postgres()
const storage = Storage.layer({
  configure: (draft) => {
    draft.add(Storage.memory())
    draft.default.set(Storage.ID.make("memory"))
  },
})
const databaseNode = makeGlobalNode({
  service: Database.Service,
  layer: Layer.effect(Database.Service, Effect.service(Database.Service)).pipe(Layer.provide(database)),
  deps: [],
})
const storageNode = makeGlobalNode({ service: Storage.Service, layer: storage, deps: [] })
const cookie = WebCookie.makeNode(Redacted.make(Buffer.alloc(32, 17).toString("base64url")))
const cipherBackend = (fill: number): Cipher.Backend =>
  Effect.runSync(
    Cipher.localBackend(Redacted.make(Buffer.alloc(32, fill).toString("base64url"))).pipe(
      Effect.provide(NodeCrypto.layer),
    ),
  )
const cipherNode = Cipher.configured(cipherBackend(23))
let sessionGraphAcquisitions = 0
const oauthCallbackNode = IntegrationOAuthCallback.configured(new URL("https://app.example"))
// Workspace graphs are acquired by the keyed map after the process graph has
// compiled, so inject their global adapters through the process composition
// seam rather than only replacing the outer graph.
const process = Application.process(
  {
    appOrigin: new URL(appOrigin),
    cipher: cipherBackend(13),
  },
  {
    cookie,
    database: databaseNode,
    storage: storageNode,
    identity: WebProvider.configured({
      provider: AuthSchema.Provider.make("closed-loop"),
      issuer: new URL("https://issuer.example/"),
      clientID: "server-test",
      clientSecret: Redacted.make("secret"),
    }),
  },
)
const trackedWorkspaceMapNode = WorkspaceMap.node({
  ...process.workspaceRuntime,
  member: (owner, key) => {
    sessionGraphAcquisitions++
    return process.workspaceRuntime.member(owner, key)
  },
})
const providerConfig = {
  provider: AuthSchema.Provider.make("closed-loop"),
  issuer: new URL("https://issuer.example/"),
  clientID: "server-test",
  clientSecret: Redacted.make("secret"),
} satisfies WebProvider.Config

const createProvider = (fixture: { readonly issuer: URL; readonly clientID: string; readonly clientSecret: string }) =>
  AuthProvider.Service.use((providers) =>
    providers.create(
      Schema.decodeUnknownSync(AuthProvider.Create)({
        id: AuthProvider.ID.create(),
        displayName: "Closed loop OIDC",
        kind: "custom",
        issuer: fixture.issuer.href,
        clientID: fixture.clientID,
        clientSecret: fixture.clientSecret,
        domains: ["bymorning.ai"],
      }),
    ),
  )

const cookiePair = (headers: Headers, name: string) => {
  const found = headers.getSetCookie().findLast((value) => value.startsWith(`${name}=`))
  if (found === undefined) throw new Error(`missing ${name} response cookie`)
  const pair = found.split(";", 1)[0]
  if (pair === undefined) throw new Error(`invalid ${name} response cookie`)
  return { pair, wire: pair.slice(name.length + 1), attributes: found.slice(pair.length) }
}

const localhostLogin = (baseURL: string, path = "/auth/login"): Promise<Response> =>
  new Promise((resolve, reject) => {
    const clientRequest = request(new URL(path, baseURL), { headers: { host: "localhost:3000" } })
    clientRequest.on("response", (response) => {
      response.resume()
      response.on("end", () => {
        const headers = new Headers()
        for (let index = 0; index < response.rawHeaders.length; index += 2) {
          const name = response.rawHeaders[index]
          const value = response.rawHeaders[index + 1]
          if (name !== undefined && value !== undefined) headers.append(name, value)
        }
        resolve(new Response(null, { status: response.statusCode, headers }))
      })
    })
    clientRequest.on("error", reject)
    clientRequest.end()
  })

describe("Server Auth closed loop", () => {
  it("completes the browser OIDC flow and sets the secure login session", async () => {
    const fixture = await start()
    const browserDatabase = postgres()
    const browserStorage = Storage.layer({
      configure: (draft) => {
        draft.add(Storage.memory())
        draft.default.set(Storage.ID.make("memory"))
      },
    })
    const nodeServer = createServer()
    const live = HttpRouter.serve(
      LayerNode.compile(LayerNode.group([process.root, Database.node, Storage.defaultNode, cookie, AuthProvider.node]), {
        replacements: [
          process.recovery.boot.replace(Layer.empty),
          Database.node.replace(browserDatabase),
          Storage.defaultNode.replace(browserStorage),
          Audit.node.replace(Audit.makeNode({ database: Database.node })),
          Cipher.node.replace(cipherNode),
        ],
      }),
      { disableListenLog: true, disableLogger: true },
    ).pipe(Layer.provideMerge(NodeHttpServer.layer(() => nodeServer, { port: 0 })))
    const application = ManagedRuntime.make(live)
    try {
      const server = await application.runPromise(HttpServer.HttpServer)
      const baseURL = HttpServer.formatAddress(server.address).replace("0.0.0.0", "127.0.0.1")
      const info = await application.runPromise(createProvider(fixture))
      const login = await localhostLogin(baseURL, `/auth/login?provider=${info.id}&redirect=/after`)
      expect(login.status).toBe(302)
      const issuerRedirect = new URL(login.headers.get("location") ?? "invalid:")
      expect(issuerRedirect.origin).toBe(fixture.issuer.origin)
      const attempt = cookiePair(login.headers, "__Secure-bm_auth_attempt_v1")
      const issued = await fixture.authorize(issuerRedirect, {
        sub: "fixture-account",
        email: "fixture@bymorning.ai",
        extra: { email_verified: true },
      })
      const callback = await fetch(new URL(`${issued.redirect.pathname}${issued.redirect.search}`, baseURL), {
        redirect: "manual",
        headers: { cookie: attempt.pair },
      })
      expect(callback.status).toBe(303)
      expect(callback.headers.get("location")).toBe(`${appOrigin}/after`)
      expect(cookiePair(callback.headers, "__Host-bm_auth").attributes).toContain("Max-Age=43200")
    } finally {
      await application.dispose()
      await fixture.close()
    }
  })

  it("returns 503 when login selects no usable method", async () => {
    const nodeServer = createServer()
    const live = HttpRouter.serve(
      LayerNode.compile(LayerNode.group([process.root, Database.node, Storage.defaultNode, cookie, AuthProvider.node]), {
        replacements: [
          process.recovery.boot.replace(Layer.empty),
          Database.node.replace(database),
          Storage.defaultNode.replace(storage),
          Audit.node.replace(Audit.makeNode({ database: Database.node })),
          Cipher.node.replace(cipherNode),
        ],
      }),
      { disableListenLog: true, disableLogger: true },
    ).pipe(Layer.provideMerge(NodeHttpServer.layer(() => nodeServer, { port: 0 })))
    const application = ManagedRuntime.make(live)
    try {
      const server = await application.runPromise(HttpServer.HttpServer)
      const baseURL = HttpServer.formatAddress(server.address).replace("0.0.0.0", "127.0.0.1")
      expect((await localhostLogin(baseURL)).status).toBe(503)
      expect((await localhostLogin(baseURL, `/auth/login?provider=${AuthProvider.ID.create()}`)).status).toBe(503)
    } finally {
      await application.dispose()
    }
  })

  it("provisions a Workspace and exercises authenticated APIs and its public MCP endpoint", async () => {
    const fixture = await start()
    const nodeServer = createServer()
    const live = HttpRouter.serve(
      LayerNode.compile(LayerNode.group([process.root, Database.node, Storage.defaultNode, cookie, AuthProvider.node]), {
        replacements: [
          process.workspaces.replace(trackedWorkspaceMapNode),
          process.adapters.oauthCallback.replace(oauthCallbackNode),
          process.recovery.boot.replace(Layer.empty),
          Database.node.replace(database),
          Storage.defaultNode.replace(storage),
          Audit.node.replace(Audit.makeNode({ database: Database.node })),
          Cipher.node.replace(cipherNode),
        ],
      }),
      { disableListenLog: true, disableLogger: true },
    ).pipe(Layer.provideMerge(NodeHttpServer.layer(() => nodeServer, { port: 0 })))
    const application = ManagedRuntime.make(live)
    try {
      const server = await application.runPromise(HttpServer.HttpServer)
      const baseURL = HttpServer.formatAddress(server.address).replace("0.0.0.0", "127.0.0.1")
      const info = await application.runPromise(createProvider(fixture))
      const loginPath = (redirect: string) => `/auth/login?provider=${info.id}&redirect=${redirect}`

      const protectedResource = await fetch(`${baseURL}/.well-known/oauth-protected-resource/mcp`)
      expect(protectedResource.status).toBe(200)
      expect(protectedResource.headers.get("content-type")).toBe("application/json")
      expect(await protectedResource.json()).toEqual({
        resource: `${appOrigin}/mcp`,
        authorization_servers: [appOrigin],
        bearer_methods_supported: ["header"],
      })
      const authorizationServer = await fetch(`${baseURL}/.well-known/oauth-authorization-server`)
      expect(authorizationServer.status).toBe(200)
      expect(authorizationServer.headers.get("content-type")).toBe("application/json")
      expect(await authorizationServer.json()).toEqual({
        issuer: appOrigin,
        authorization_endpoint: `${appOrigin}/oauth/authorize`,
        token_endpoint: `${appOrigin}/oauth/token`,
        registration_endpoint: `${appOrigin}/oauth/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      })
      const invalidRegistration = await fetch(`${baseURL}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: ["relative"] }),
      })
      expect(invalidRegistration.status).toBe(400)
      expect(await invalidRegistration.json()).toEqual({ error: "invalid_redirect_uri" })

      const login = await localhostLogin(baseURL, loginPath("%2F%5Cevil.example%2Fpath"))
      expect(login.status).toBe(302)
      const issuerRedirect = new URL(login.headers.get("location") ?? "invalid:")
      expect(issuerRedirect.origin).toBe(fixture.issuer.origin)
      const attempt = cookiePair(login.headers, "__Secure-bm_auth_attempt_v1")
      expect(attempt.attributes).toBe("; Max-Age=600; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax")
      const decodedAttempt = await application.runPromise(
        Effect.gen(function* () {
          const cookies = yield* WebCookie.Service
          return yield* cookies.decrypt(yield* Schema.decodeUnknownEffect(WebCookie.Value)(Redacted.make(attempt.wire)))
        }),
      )
      if (decodedAttempt.type !== "attempt") throw new Error("expected authentication attempt")
      expect(Redacted.value(decodedAttempt.state).length).toBeGreaterThan(0)
      expect(decodedAttempt.binding).toEqual({ type: "oidc", provider: { id: info.id, revision: info.revision } })
      expect(decodedAttempt.redirectURI.href).toBe(`${appOrigin}/auth/callback/${info.id}`)
      expect(DateTime.isLessThanOrEqualTo(decodedAttempt.expiresAt, DateTime.nowUnsafe())).toBe(false)

      const identity = { sub: "closed-loop-account", email: "closed-loop@bymorning.ai", extra: { email_verified: true } }
      const loginIssued = await fixture.authorize(issuerRedirect, identity)
      const callback = await fetch(new URL(`${loginIssued.redirect.pathname}${loginIssued.redirect.search}`, baseURL), {
        redirect: "manual",
        headers: { cookie: attempt.pair },
      })
      expect(callback.status).toBe(303)
      expect(callback.headers.get("location")).toBe(`${appOrigin}/`)
      const accountCookie = cookiePair(callback.headers, "__Host-bm_auth")
      expect(accountCookie.attributes).toBe("; Max-Age=43200; Path=/; HttpOnly; Secure; SameSite=Lax")
      expect(cookiePair(callback.headers, "__Secure-bm_auth_attempt_v1").attributes).toBe(
        "; Max-Age=0; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax",
      )

      const consentLogin = await localhostLogin(baseURL, loginPath("/oauth/consent?request=x"))
      expect(consentLogin.status).toBe(302)
      const consentIssuerRedirect = new URL(consentLogin.headers.get("location") ?? "invalid:")
      expect(consentIssuerRedirect.origin).toBe(fixture.issuer.origin)
      const consentAttempt = cookiePair(consentLogin.headers, "__Secure-bm_auth_attempt_v1")
      expect(consentAttempt.attributes).toBe("; Max-Age=600; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax")

      const consentIssued = await fixture.authorize(consentIssuerRedirect, identity)
      const consentCallback = await fetch(
        new URL(`${consentIssued.redirect.pathname}${consentIssued.redirect.search}`, baseURL),
        {
          redirect: "manual",
          headers: { cookie: consentAttempt.pair },
        },
      )
      expect(consentCallback.status).toBe(303)
      expect(consentCallback.headers.get("location")).toBe(`${appOrigin}/oauth/consent?request=x`)

      const replay = await fetch(new URL(`${loginIssued.redirect.pathname}${loginIssued.redirect.search}`, baseURL), {
        redirect: "manual",
        headers: { cookie: attempt.pair },
      })
      expect(replay.status).toBe(303)
      expect(replay.headers.get("location")).toBe(`${appOrigin}/login?auth=failed&reason=exchange`)
      expect(replay.headers.get("set-cookie")).toContain("__Secure-bm_auth_attempt_v1=")

      const defectLogin = await localhostLogin(baseURL, loginPath("%2F"))
      const defectAttempt = cookiePair(defectLogin.headers, "__Secure-bm_auth_attempt_v1")
      const defectIssued = await fixture.authorize(
        new URL(defectLogin.headers.get("location") ?? "invalid:"),
        identity,
      )
      const defectURL = new URL(`${defectIssued.redirect.pathname}${defectIssued.redirect.search}`, baseURL)
      defectURL.searchParams.set("code", "defect-code")
      const defectCallback = await fetch(defectURL, {
        redirect: "manual",
        headers: { cookie: defectAttempt.pair },
      })
      expect(defectCallback.status).toBe(303)
      expect(defectCallback.headers.get("location")).toBe(`${appOrigin}/login?auth=failed&reason=exchange`)

      const provisioned = await application.runPromise(
        Effect.gen(function* () {
          const cookies = yield* WebCookie.Service
          const value = yield* Schema.decodeUnknownEffect(WebCookie.Value)(Redacted.make(accountCookie.wire))
          const envelopeWire = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(
            Buffer.from(accountCookie.wire, "base64url").toString("utf8"),
          )
          const envelope = yield* Schema.decodeUnknownEffect(Schema.Struct({ version: Schema.Literal("v1") }))(
            envelopeWire,
          )
          const payload = yield* cookies.decrypt(value)
          const database = yield* Database.Service
          return {
            envelope,
            payload,
            accounts: yield* database.use("AuthPostgresTest.accounts", (db) => db.select().from(AccountTable)),
            authLinks: yield* database.use("AuthPostgresTest.links", (db) => db.select().from(AuthTable)),
            workspaces: yield* database.use("AuthPostgresTest.workspaces", (db) => db.select().from(WorkspaceTable)),
            users: yield* database.use("AuthPostgresTest.users", (db) => db.select().from(UserTable)),
            agents: yield* database.use("AuthPostgresTest.agents", (db) => db.select().from(AgentTable)),
            projects: yield* database.use("AuthPostgresTest.projects", (db) => db.select().from(ProjectTable)),
          }
        }),
      )
      expect(provisioned.envelope.version).toBe("v1")
      expect(provisioned.payload.type).toBe("session")
      expect(provisioned.accounts).toHaveLength(1)
      expect(provisioned.authLinks).toHaveLength(1)
      expect(provisioned.users).toHaveLength(1)
      if (provisioned.payload.type !== "session") throw new Error("expected Session cookie payload")
      const accountID = provisioned.payload.accountID
      expect(accountID).toBe(provisioned.accounts[0]?.id)
      const provisionedWorkspaceID = provisioned.users[0]?.workspaceId
      if (provisionedWorkspaceID === undefined) throw new Error("expected provisioned Workspace")
      expect(provisioned.workspaces.filter(({ id }) => id === provisionedWorkspaceID)).toHaveLength(1)
      expect(provisioned.workspaces.find(({ id }) => id === provisionedWorkspaceID)?.name).toBe("Default")
      expect(provisioned.workspaces.find(({ id }) => id === provisionedWorkspaceID)?.slug).toBeNull()
      expect(provisioned.agents.filter(({ workspaceId }) => workspaceId === provisionedWorkspaceID)).toHaveLength(0)
      const defaultProject = provisioned.projects.find(({ workspaceID }) => workspaceID === provisionedWorkspaceID)
      expect(defaultProject?.name).toBe("Default")
      if (defaultProject === undefined) throw new Error("expected provisioned default Project")
      expect(
        Option.isSome(
          await application.runPromise(
            Storage.Service.use((storage) =>
              storage.object.get([{ workspaces: provisionedWorkspaceID }, { projects: defaultProject.id }]),
            ),
          ),
        ),
      ).toBe(true)
      // The inbound MCP gateway exposes project/plugin Tools, while built-ins remain private to core sessions.
      await application.runPromise(
        Effect.gen(function* () {
          const projectStorage = yield* ProjectStorage.make(provisionedWorkspaceID, defaultProject.id)
          yield* projectStorage.set(["plugin", "tool.ts"], {
            body: Stream.succeed(
              Buffer.from(`import { Plugin } from "@bymorning/plugin/effect"
import { Effect, Schema } from "effect"

export default Plugin.define({
  id: "project.tool.echo",
  effect: (context) =>
    Effect.asVoid(
      context.tool.transform((draft) =>
        draft.add({
          name: "echo",
          description: "Echo text back to the caller.",
          input: Schema.Struct({ text: Schema.String }),
          output: Schema.String,
          execute: (input) => Effect.succeed({
            output: input.text,
            content: [{ type: "text", text: input.text }],
          }),
        }),
      ),
    ),
})
`),
            ),
          })
        }),
      )

      const authenticated = { cookie: accountCookie.pair }
      const workspaceResponse = await fetch(`${baseURL}/api/workspaces`, { headers: authenticated })
      expect(workspaceResponse.status).toBe(200)
      expect(Schema.decodeUnknownSync(Schema.Array(WorkspaceSchema.Info))(await workspaceResponse.json())).toEqual([
        { id: provisionedWorkspaceID, name: "Default", status: "active" },
      ])

      const configResponse = await fetch(`${baseURL}/api/config`, { headers: authenticated })
      expect(configResponse.status).toBe(200)
      expect(Schema.decodeUnknownSync(ConfigSchema.Info)(await configResponse.json())).toEqual(defaultConfig)

      const mcpPermissions = [
        { action: "*", resource: "*", effect: "deny" },
        { action: "execute", resource: "*", effect: "allow" },
        { action: "echo", resource: "*", effect: "allow" },
      ]
      const configuredPermissionsResponse = await fetch(`${baseURL}/api/config`, {
        method: "PUT",
        headers: { ...authenticated, "content-type": "application/json", origin: appOrigin },
        body: JSON.stringify({ permissions: mcpPermissions }),
      })
      expect(configuredPermissionsResponse.status).toBe(200)
      expect(
        Schema.decodeUnknownSync(ConfigSchema.Info)(await configuredPermissionsResponse.json()).permissions,
      ).toEqual(mcpPermissions)
      const refreshedPermissionsResponse = await fetch(`${baseURL}/api/config/refresh`, {
        method: "POST",
        headers: { ...authenticated, origin: appOrigin },
      })
      expect(refreshedPermissionsResponse.status).toBe(200)
      expect(
        Schema.decodeUnknownSync(ConfigSchema.Info)(await refreshedPermissionsResponse.json()).permissions,
      ).toEqual(mcpPermissions)
      // MCP Tool discovery is read-only; Tool settings are written under permission.
      const mcpToolsURL = `${baseURL}/api/mcp/tool?workspace=${provisionedWorkspaceID}`
      expect((await fetch(mcpToolsURL, { headers: authenticated })).status).toBe(200)
      expect(
        (
          await fetch(mcpToolsURL, {
            method: "PUT",
            headers: { ...authenticated, "content-type": "application/json", origin: appOrigin },
            body: JSON.stringify({ tools: [] }),
          })
        ).status,
      ).toBe(404)

      const registrationResponse = await fetch(`${baseURL}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: ["http://127.0.0.1/callback"], client_name: "Server test" }),
      })
      expect(registrationResponse.status).toBe(201)
      const registrationBody = await registrationResponse.json()
      const registration = Schema.decodeUnknownSync(Schema.Struct({ client_id: Schema.String }))(registrationBody)
      expect(registrationBody).toEqual({
        client_id: registration.client_id,
        redirect_uris: ["http://127.0.0.1/callback"],
        client_name: "Server test",
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      })
      expect(registrationBody).not.toHaveProperty("client_secret")
      const unknownAuthorization = await fetch(
        `${baseURL}/oauth/authorize?response_type=code&client_id=ocl_unknown&redirect_uri=${encodeURIComponent("http://127.0.0.1/callback")}`,
        { redirect: "manual" },
      )
      expect(unknownAuthorization.status).toBe(400)
      expect(unknownAuthorization.headers.get("location")).toBeNull()
      const invalidRedirectAuthorization = await fetch(
        `${baseURL}/oauth/authorize?response_type=code&client_id=${registration.client_id}&redirect_uri=${encodeURIComponent("http://127.0.0.1/other")}`,
        { redirect: "manual" },
      )
      expect(invalidRedirectAuthorization.status).toBe(400)
      expect(invalidRedirectAuthorization.headers.get("location")).toBeNull()
      const missingPkce = await fetch(
        `${baseURL}/oauth/authorize?response_type=code&client_id=${registration.client_id}&redirect_uri=${encodeURIComponent("http://127.0.0.1/callback")}`,
        { redirect: "manual" },
      )
      expect(new URL(missingPkce.headers.get("location") ?? "invalid:").searchParams.get("error")).toBe(
        "invalid_request",
      )
      const verifier = "closed-loop-verifier"
      const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", Buffer.from(verifier, "ascii"))).toString(
        "base64url",
      )
      const authorizationResponse = await fetch(
        `${baseURL}/oauth/authorize?response_type=code&client_id=${registration.client_id}&redirect_uri=${encodeURIComponent("http://127.0.0.1/callback")}&code_challenge=${challenge}&code_challenge_method=S256`,
        { redirect: "manual" },
      )
      expect(authorizationResponse.status).toBe(302)
      const requestID = new URL(authorizationResponse.headers.get("location") ?? "invalid:").searchParams.get("request")
      if (requestID === null) throw new Error("expected OAuth request")
      for (const origin of [undefined, "https://evil.example"]) {
        const rejected = await fetch(`${baseURL}/api/oauth/approve`, {
          method: "POST",
          headers: {
            ...authenticated,
            "content-type": "application/json",
            ...(origin === undefined ? {} : { origin }),
          },
          body: JSON.stringify({ requestID, workspaceID: provisionedWorkspaceID }),
        })
        expect(rejected.status).toBe(403)
        expect(await rejected.json()).toEqual({ _tag: "ForbiddenError", message: "Origin not allowed" })
      }
      const forbiddenApproval = await fetch(`${baseURL}/api/oauth/approve`, {
        method: "POST",
        headers: { ...authenticated, "content-type": "application/json", origin: appOrigin },
        body: JSON.stringify({ requestID, workspaceID: WorkspaceSchema.ID.create() }),
      })
      expect(forbiddenApproval.status).toBe(403)
      expect(await forbiddenApproval.json()).toEqual({ _tag: "ForbiddenError", message: "Workspace access denied" })
      const approvalResponse = await fetch(`${baseURL}/api/oauth/approve`, {
        method: "POST",
        headers: { ...authenticated, "content-type": "application/json", origin: appOrigin },
        body: JSON.stringify({ requestID, workspaceID: provisionedWorkspaceID }),
      })
      expect(approvalResponse.status).toBe(200)
      const code = new URL(((await approvalResponse.json()) as { url: string }).url).searchParams.get("code")
      if (code === null) throw new Error("expected OAuth code")
      const denialAuthorization = await fetch(
        `${baseURL}/oauth/authorize?response_type=code&client_id=${registration.client_id}&redirect_uri=${encodeURIComponent("http://127.0.0.1/callback")}&code_challenge=${challenge}&code_challenge_method=S256`,
        { redirect: "manual" },
      )
      const denialRequestID = new URL(denialAuthorization.headers.get("location") ?? "invalid:").searchParams.get(
        "request",
      )
      if (denialRequestID === null) throw new Error("expected OAuth denial request")
      for (const origin of [undefined, "https://evil.example"]) {
        const rejected = await fetch(`${baseURL}/api/oauth/deny`, {
          method: "POST",
          headers: {
            ...authenticated,
            "content-type": "application/json",
            ...(origin === undefined ? {} : { origin }),
          },
          body: JSON.stringify({ requestID: denialRequestID }),
        })
        expect(rejected.status).toBe(403)
        expect(await rejected.json()).toEqual({ _tag: "ForbiddenError", message: "Origin not allowed" })
      }
      const wrongVerifierResponse = await fetch(`${baseURL}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: "wrong",
          client_id: registration.client_id,
          redirect_uri: "http://127.0.0.1/callback",
        }),
      })
      expect(await wrongVerifierResponse.json()).toEqual({ error: "invalid_grant" })
      const tokenResponse = await fetch(`${baseURL}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          client_id: registration.client_id,
          redirect_uri: "http://127.0.0.1/callback",
        }),
      })
      expect(tokenResponse.status).toBe(200)
      const issued = Schema.decodeUnknownSync(
        Schema.Struct({ access_token: Schema.String, refresh_token: Schema.String }),
      )(await tokenResponse.json())
      const refreshResponse = await fetch(`${baseURL}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: issued.refresh_token,
          client_id: registration.client_id,
        }),
      })
      expect(refreshResponse.status).toBe(200)
      const tokens = Schema.decodeUnknownSync(
        Schema.Struct({ access_token: Schema.String, refresh_token: Schema.String }),
      )(await refreshResponse.json())
      const oldAccess = await fetch(`${baseURL}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${issued.access_token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      })
      expect(oldAccess.status).toBe(401)
      const mcpClient = new Client({ name: "server-postgres-test", version: "1" })
      const mcpTransport = new StreamableHTTPClientTransport(new URL("/mcp", baseURL), {
        requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } },
      })
      try {
        await mcpClient.connect(mcpTransport)
        const mcpTools = await mcpClient.listTools()
        expect(mcpTools.tools.map((tool) => tool.name)).toEqual(["execute", "mcp_resume"])
        const catalog = await mcpClient.callTool({
          name: "execute",
          arguments: { description: "List Code Mode tools", code: "return search({}).items.map((tool) => tool.path)" },
        })
        const discovered = Schema.decodeUnknownSync(
          Schema.Struct({ structuredContent: Schema.Struct({ output: Schema.String }) }),
        )(catalog)
        expect(JSON.parse(discovered.structuredContent.output)).toEqual(["tools.echo"])
        expect(
          await mcpClient.callTool({
            name: "execute",
            arguments: { description: "Echo gateway", code: 'return await tools.echo({ text: "gateway" })' },
          }),
        ).toMatchObject({ content: [{ type: "text", text: "gateway" }], structuredContent: { output: "gateway" } })
        expect(
          await mcpClient.callTool({
            name: "execute",
            arguments: { description: "Read missing file", code: 'return await tools.read({ path: "missing.txt" })' },
          }),
        ).toMatchObject({ structuredContent: { error: true } })

        const deniedExecuteResponse = await fetch(`${baseURL}/api/config`, {
          method: "PUT",
          headers: { ...authenticated, "content-type": "application/json", origin: appOrigin },
          body: JSON.stringify({ permissions: [{ action: "execute", resource: "*", effect: "deny" }] }),
        })
        expect(deniedExecuteResponse.status).toBe(200)
        expect((await mcpClient.listTools()).tools.map((tool) => tool.name)).toEqual(["mcp_resume"])
        await expect(
          mcpClient.callTool({
            name: "execute",
            arguments: { description: "Echo gateway", code: 'return await tools.echo({ text: "gateway" })' },
          }),
        ).rejects.toMatchObject({ code: -32602, message: "Unknown tool" })
      } finally {
        await mcpClient.close()
      }

      const reuseAuthorization = await fetch(
        `${baseURL}/oauth/authorize?response_type=code&client_id=${registration.client_id}&redirect_uri=${encodeURIComponent("http://127.0.0.1/callback")}&code_challenge=${challenge}&code_challenge_method=S256`,
        { redirect: "manual" },
      )
      const reuseRequestID = new URL(reuseAuthorization.headers.get("location") ?? "invalid:").searchParams.get(
        "request",
      )
      if (reuseRequestID === null) throw new Error("expected OAuth reuse request")
      const reuseApproval = await fetch(`${baseURL}/api/oauth/approve`, {
        method: "POST",
        headers: { ...authenticated, "content-type": "application/json", origin: appOrigin },
        body: JSON.stringify({ requestID: reuseRequestID, workspaceID: provisionedWorkspaceID }),
      })
      const reuseCode = new URL(((await reuseApproval.json()) as { url: string }).url).searchParams.get("code")
      if (reuseCode === null) throw new Error("expected OAuth reuse code")
      const reuseExchange = await fetch(`${baseURL}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: reuseCode,
          code_verifier: verifier,
          client_id: registration.client_id,
          redirect_uri: "http://127.0.0.1/callback",
        }),
      })
      const reuseTokens = Schema.decodeUnknownSync(Schema.Struct({ access_token: Schema.String }))(
        await reuseExchange.json(),
      )
      const workingAccess = await fetch(`${baseURL}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${reuseTokens.access_token}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      })
      expect(workingAccess.status).toBe(200)
      const reusedCode = await fetch(`${baseURL}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: reuseCode,
          code_verifier: verifier,
          client_id: registration.client_id,
          redirect_uri: "http://127.0.0.1/callback",
        }),
      })
      expect(reusedCode.status).toBe(400)
      expect(await reusedCode.json()).toEqual({ error: "invalid_grant" })
      const revokedAccess = await fetch(`${baseURL}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${reuseTokens.access_token}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      })
      expect(revokedAccess.status).toBe(401)

      await application.runPromise(
        Database.Service.use((database) =>
          database.use("AuthPostgresTest.expireOAuthGrant", (db) =>
            db.update(OAuthGrantTable).set({ timeAccessExpires: new Date(0) }),
          ),
        ),
      )
      const expiredAccess = await fetch(`${baseURL}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${tokens.access_token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      })
      expect(expiredAccess.status).toBe(401)
      expect(expiredAccess.headers.get("www-authenticate")).toBe(
        `Bearer resource_metadata="${appOrigin}/.well-known/oauth-protected-resource/mcp"`,
      )

      const unknownMcpWorkspace = await fetch(`${baseURL}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      })
      expect(unknownMcpWorkspace.status).toBe(401)
      expect(unknownMcpWorkspace.headers.get("www-authenticate")).toBe(
        `Bearer resource_metadata="${appOrigin}/.well-known/oauth-protected-resource/mcp"`,
      )

      await application.runPromise(
        Database.Service.use((database) =>
          database.use("AuthPostgresTest.suspendWorkspace", (db) =>
            db.update(WorkspaceTable).set({ status: "suspended" }).where(eq(WorkspaceTable.id, provisionedWorkspaceID)),
          ),
        ),
      )
      const suspendedMcpWorkspace = await fetch(`${baseURL}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${tokens.access_token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      })
      expect(suspendedMcpWorkspace.status).toBe(401)
      expect(suspendedMcpWorkspace.headers.get("www-authenticate")).toBe(
        `Bearer resource_metadata="${appOrigin}/.well-known/oauth-protected-resource/mcp"`,
      )
      await application.runPromise(
        Database.Service.use((database) =>
          database.use("AuthPostgresTest.activateWorkspace", (db) =>
            db.update(WorkspaceTable).set({ status: "active" }).where(eq(WorkspaceTable.id, provisionedWorkspaceID)),
          ),
        ),
      )

      // Replaying the rotated-out refresh token is reuse: the grant family is revoked.
      const oldRefresh = await fetch(`${baseURL}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: issued.refresh_token,
          client_id: registration.client_id,
        }),
      })
      expect(await oldRefresh.json()).toEqual({ error: "invalid_grant" })
      const rotatedRefresh = await fetch(`${baseURL}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token,
          client_id: registration.client_id,
        }),
      })
      expect(await rotatedRefresh.json()).toEqual({ error: "invalid_grant" })

      const agentResponse = await fetch(`${baseURL}/api/agent`, { headers: authenticated })
      expect(agentResponse.status).toBe(200)
      expect(Schema.decodeUnknownSync(Schema.Array(AgentSchema.Info))(await agentResponse.json())).toEqual([
        {
          id: "default",
          name: "Default",
          description: "The primary chat agent that orchestrates for the user.",
          // This case covers Agent route authorization, not prompt wording. Match the shipped
          // Default prompt loosely so editing it does not fail an unrelated auth test.
          instructions: expect.stringContaining("Default Agent in ByMorning"),
          mode: "primary",
          hidden: false,
          steps: null,
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
          overridden: false,
        },
        {
          id: "general",
          name: "General",
          instructions: "",
          description:
            "General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.",
          mode: "subagent",
          hidden: false,
          steps: null,
          permissions: [
            { action: "*", resource: "*", effect: "allow" },
            { action: "read", resource: "*.env", effect: "ask" },
            { action: "read", resource: "*.env.*", effect: "ask" },
            { action: "read", resource: "*.env.example", effect: "allow" },
            { action: "question", resource: "*", effect: "deny" },
            { action: "subagent", resource: "*", effect: "deny" },
          ],
          overridden: false,
        },
        {
          id: "explore",
          name: "Explore",
          description:
            'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.',
          instructions: `You are a file search specialist. You excel at thoroughly navigating and exploring codebases.

Your strengths:
- Rapidly finding files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents

Guidelines:
- Use Glob for broad file pattern matching
- Use Grep for searching file contents with regex
- Use Read when you know the specific file path you need to read
- Adapt your search approach based on the thoroughness level specified by the caller
- Return file paths as absolute paths in your final response
- For clear communication, avoid using emojis
- Do not create any files, or run shell commands that modify the user's system state in any way

Complete the user's search request efficiently and report your findings clearly.`,
          mode: "subagent",
          hidden: false,
          steps: null,
          permissions: [
            { action: "*", resource: "*", effect: "deny" },
            { action: "execute", resource: "*", effect: "allow" },
            { action: "grep", resource: "*", effect: "allow" },
            { action: "glob", resource: "*", effect: "allow" },
            { action: "webfetch", resource: "*", effect: "allow" },
            { action: "websearch", resource: "*", effect: "allow" },
            { action: "read", resource: "*", effect: "allow" },
            { action: "read", resource: "*.env", effect: "ask" },
            { action: "read", resource: "*.env.*", effect: "ask" },
            { action: "read", resource: "*.env.example", effect: "allow" },
            { action: "subagent", resource: "*", effect: "deny" },
            { action: "external_directory", resource: "*", effect: "ask" },
          ],
          overridden: false,
        },
      ])
      const integrationResponse = await fetch(`${baseURL}/api/integration`, { headers: authenticated })
      expect(integrationResponse.status).toBe(200)
      expect(
        Schema.decodeUnknownSync(Schema.Array(Integration.Info))(await integrationResponse.json()).map(
          ({ id, name, methods }) => ({ id, name, methods }),
        ),
      ).toEqual([
        {
          id: "amazon-bedrock",
          name: "Amazon Bedrock",
          methods: [
            {
              type: "key",
              label: "Bedrock API key",
              form: [
                {
                  key: "region",
                  type: "string",
                  title: "AWS region",
                  required: true,
                },
              ],
            },
            {
              type: "aws-sigv4",
              id: "bedrock-sigv4",
              label: "AWS credentials",
              region: {
                key: "region",
                type: "string",
                title: "AWS region",
                required: true,
              },
            },
            {
              type: "env-group",
              id: "bedrock-bearer-env",
              authKind: "bedrock-bearer",
              available: false,
            },
            {
              type: "env-group",
              id: "bedrock-sigv4-env",
              authKind: "aws-sigv4",
              available: false,
            },
          ],
        },
        {
          id: "anthropic",
          name: "Anthropic",
          methods: [{ type: "key" }, { type: "env", names: ["ANTHROPIC_API_KEY"] }],
        },
        {
          id: "baseten",
          name: "Baseten",
          methods: [{ type: "key" }, { type: "env", names: ["BASETEN_API_KEY"] }],
        },
        {
          id: "cerebras",
          name: "Cerebras",
          methods: [{ type: "key" }, { type: "env", names: ["CEREBRAS_API_KEY"] }],
        },
        {
          id: "deepinfra",
          name: "Deep Infra",
          methods: [{ type: "key" }, { type: "env", names: ["DEEPINFRA_API_KEY"] }],
        },
        {
          id: "deepseek",
          name: "DeepSeek",
          methods: [{ type: "key" }, { type: "env", names: ["DEEPSEEK_API_KEY"] }],
        },
        {
          id: "exa",
          name: "Exa",
          methods: [{ type: "key" }, { type: "env", names: ["EXA_API_KEY"] }],
        },
        {
          id: "firecrawl",
          name: "Firecrawl",
          methods: [{ type: "key" }, { type: "env", names: ["FIRECRAWL_API_KEY"] }],
        },
        {
          id: "fireworks",
          name: "Fireworks",
          methods: [{ type: "key" }, { type: "env", names: ["FIREWORKS_API_KEY"] }],
        },
        {
          id: "google",
          name: "Google",
          methods: [
            { type: "key" },
            {
              type: "env",
              names: ["GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
            },
          ],
        },
        {
          id: "groq",
          name: "Groq",
          methods: [{ type: "key" }, { type: "env", names: ["GROQ_API_KEY"] }],
        },
        {
          id: "mistral",
          name: "Mistral",
          methods: [{ type: "key" }, { type: "env", names: ["MISTRAL_API_KEY"] }],
        },
        {
          id: "openai",
          name: "OpenAI",
          methods: [{ type: "key" }, { type: "env", names: ["OPENAI_API_KEY"] }],
        },
        {
          id: "opencode",
          name: "OpenCode Zen",
          methods: [{ type: "key" }, { type: "env", names: ["OPENCODE_API_KEY"] }],
        },
        {
          id: "openrouter",
          name: "OpenRouter",
          methods: [{ type: "key" }, { type: "env", names: ["OPENROUTER_API_KEY"] }],
        },
        {
          id: "parallel",
          name: "Parallel",
          methods: [{ type: "key" }, { type: "env", names: ["PARALLEL_API_KEY"] }],
        },
        {
          id: "tavily",
          name: "Tavily",
          methods: [{ type: "key" }, { type: "env", names: ["TAVILY_API_KEY"] }],
        },
        {
          id: "togetherai",
          name: "Together AI",
          methods: [{ type: "key" }, { type: "env", names: ["TOGETHER_API_KEY"] }],
        },
        {
          id: "xai",
          name: "xAI",
          methods: [{ type: "key" }, { type: "env", names: ["XAI_API_KEY"] }],
        },
      ])
      const updatedConfigResponse = await fetch(`${baseURL}/api/config`, {
        method: "PUT",
        headers: { ...authenticated, "content-type": "application/json", origin: appOrigin },
        body: JSON.stringify({ default_agent: "general" }),
      })
      expect(updatedConfigResponse.status).toBe(200)
      expect(Schema.decodeUnknownSync(ConfigSchema.Info)(await updatedConfigResponse.json())).toEqual({
        default_agent: "general",
        ...defaultConfig,
      })
      const refreshedConfigResponse = await fetch(`${baseURL}/api/config/refresh`, {
        method: "POST",
        headers: { ...authenticated, origin: appOrigin },
      })
      expect(refreshedConfigResponse.status).toBe(200)
      expect(Schema.decodeUnknownSync(ConfigSchema.Info)(await refreshedConfigResponse.json())).toEqual({
        default_agent: "general",
        ...defaultConfig,
      })

      // A later usable membership proves omission chooses the stable oldest membership,
      // rather than whichever Workspace happens to be returned first.
      const laterWorkspaceID = WorkspaceSchema.ID.create()
      await application.runPromise(
        Effect.gen(function* () {
          const database = yield* Database.Service
          const later = new Date(Date.now() + 60_000)
          yield* database.use("AuthPostgresTest.membership", (db) =>
            Effect.gen(function* () {
              yield* db.insert(WorkspaceTable).values({
                id: laterWorkspaceID,
                name: "Later",
                status: "active",
                timeCreated: later,
                timeUpdated: later,
              })
              yield* db.insert(UserTable).values({
                id: UserSchema.ID.create(),
                accountId: accountID,
                workspaceId: laterWorkspaceID,
                role: "member",
                timeCreated: later,
                timeUpdated: later,
              })
              yield* db.insert(ConfigTable).values({ workspaceId: laterWorkspaceID })
              yield* db.insert(ProjectTable).values({
                id: ProjectSchema.ID.create(),
                workspaceID: laterWorkspaceID,
                name: "Default",
              })
            }),
          )
        }),
      )

      const memberAuthorization = await fetch(
        `${baseURL}/oauth/authorize?response_type=code&client_id=${registration.client_id}&redirect_uri=${encodeURIComponent("http://127.0.0.1/callback")}&code_challenge=${challenge}&code_challenge_method=S256`,
        { redirect: "manual" },
      )
      const memberRequestID = new URL(memberAuthorization.headers.get("location") ?? "invalid:").searchParams.get(
        "request",
      )
      if (memberRequestID === null) throw new Error("expected member OAuth request")
      const memberApproval = await fetch(`${baseURL}/api/oauth/approve`, {
        method: "POST",
        headers: { ...authenticated, "content-type": "application/json", origin: appOrigin },
        body: JSON.stringify({ requestID: memberRequestID, workspaceID: laterWorkspaceID }),
      })
      expect(memberApproval.status).toBe(200)

      const keyResponse = await fetch(`${baseURL}/api/integration/exa/connect/key`, {
        method: "POST",
        headers: { ...authenticated, origin: appOrigin, "content-type": "application/json" },
        body: JSON.stringify({ key: "workspace-isolation-secret", label: "Default Workspace" }),
      })
      expect(keyResponse.status).toBe(204)
      const connected = Schema.decodeUnknownSync(Integration.Info)(
        await (await fetch(`${baseURL}/api/integration/exa`, { headers: authenticated })).json(),
      )
      const connection = connected.connections[0]
      if (connection?.type !== "credential") throw new Error("expected credential connection")
      const foreignIntegration = Schema.decodeUnknownSync(Integration.Info)(
        await (
          await fetch(`${baseURL}/api/integration/exa?workspace=${laterWorkspaceID}`, { headers: authenticated })
        ).json(),
      )
      expect(foreignIntegration.connections).toEqual([])
      const foreignCredentialRename = await fetch(
        `${baseURL}/api/credential/${connection.id}?workspace=${laterWorkspaceID}`,
        {
          method: "PATCH",
          headers: { ...authenticated, origin: appOrigin, "content-type": "application/json" },
          body: JSON.stringify({ label: "Foreign Workspace" }),
        },
      )
      expect(foreignCredentialRename.status).toBe(403)
      const foreignCredentialActivate = await fetch(
        `${baseURL}/api/credential/${connection.id}/activate?workspace=${laterWorkspaceID}`,
        { method: "POST", headers: { ...authenticated, origin: appOrigin } },
      )
      expect(foreignCredentialActivate.status).toBe(403)
      const foreignCredentialDelete = await fetch(
        `${baseURL}/api/credential/${connection.id}?workspace=${laterWorkspaceID}`,
        { method: "DELETE", headers: { ...authenticated, origin: appOrigin } },
      )
      expect(foreignCredentialDelete.status).toBe(403)
      const stillConnected = Schema.decodeUnknownSync(Integration.Info)(
        await (await fetch(`${baseURL}/api/integration/exa`, { headers: authenticated })).json(),
      )
      expect(stillConnected.connections).toContainEqual(connection)
      expect(JSON.stringify(stillConnected)).not.toContain("workspace-isolation-secret")
      const credentialDelete = await fetch(`${baseURL}/api/credential/${connection.id}`, {
        method: "DELETE",
        headers: { ...authenticated, origin: appOrigin },
      })
      expect(credentialDelete.status).toBe(204)

      const skillInput = {
        name: "Review",
        description: "Reviews changes",
        instructions: "Inspect carefully",
      }
      const skillCreate = await fetch(`${baseURL}/api/skill`, {
        method: "POST",
        headers: { ...authenticated, origin: appOrigin, "content-type": "application/json" },
        body: JSON.stringify(skillInput),
      })
      expect(skillCreate.status).toBe(201)
      const createdSkill = Schema.decodeUnknownSync(SkillSchema.Info)(await skillCreate.json())
      expect(createdSkill).toMatchObject(skillInput)

      const foreignSkill = await fetch(`${baseURL}/api/skill/${createdSkill.id}?workspace=${laterWorkspaceID}`, {
        headers: authenticated,
      })
      expect(foreignSkill.status).toBe(404)
      const foreignUpdate = await fetch(`${baseURL}/api/skill/${createdSkill.id}?workspace=${laterWorkspaceID}`, {
        method: "PUT",
        headers: { ...authenticated, origin: appOrigin, "content-type": "application/json" },
        body: JSON.stringify(skillInput),
      })
      expect(foreignUpdate.status).toBe(403)
      const foreignDelete = await fetch(`${baseURL}/api/skill/${createdSkill.id}?workspace=${laterWorkspaceID}`, {
        method: "DELETE",
        headers: { ...authenticated, origin: appOrigin },
      })
      expect(foreignDelete.status).toBe(403)
      const laterSkills = await fetch(`${baseURL}/api/skill?workspace=${laterWorkspaceID}`, { headers: authenticated })
      expect(laterSkills.status).toBe(200)
      expect(Schema.decodeUnknownSync(Schema.Array(SkillSchema.Info))(await laterSkills.json())).not.toContainEqual(
        createdSkill,
      )

      const replacement = { name: "Audit", description: "Audits changes", instructions: "Replace every field" }
      const skillUpdate = await fetch(`${baseURL}/api/skill/${createdSkill.id}`, {
        method: "PUT",
        headers: { ...authenticated, origin: appOrigin, "content-type": "application/json" },
        body: JSON.stringify(replacement),
      })
      expect(skillUpdate.status).toBe(200)
      expect(Schema.decodeUnknownSync(SkillSchema.Info)(await skillUpdate.json())).toEqual({
        id: createdSkill.id,
        ...replacement,
      })
      const skillDelete = await fetch(`${baseURL}/api/skill/${createdSkill.id}`, {
        method: "DELETE",
        headers: { ...authenticated, origin: appOrigin },
      })
      expect(skillDelete.status).toBe(204)
      expect((await fetch(`${baseURL}/api/skill/${createdSkill.id}`, { headers: authenticated })).status).toBe(404)

      const projectResponse = await fetch(`${baseURL}/api/project`, { headers: authenticated })
      expect(projectResponse.status).toBe(200)
      const projects = Schema.decodeUnknownSync(Schema.Array(ProjectSchema.Info))(await projectResponse.json())
      expect(projects).toHaveLength(1)
      expect(projects[0]?.name).toBe("Default")

      const extraResponse = await fetch(`${baseURL}/api/project`, {
        method: "POST",
        headers: { ...authenticated, origin: appOrigin, "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      expect(extraResponse.status).toBe(201)
      const extra = Schema.decodeUnknownSync(ProjectSchema.Info)(await extraResponse.json())
      expect(extra.name).toBe("Default")
      expect(
        Option.isSome(
          await application.runPromise(
            Storage.Service.use((storage) =>
              storage.object.get([{ workspaces: provisionedWorkspaceID }, { projects: extra.id }]),
            ),
          ),
        ),
      ).toBe(true)
      const missingResponse = await fetch(`${baseURL}/api/project/${ProjectSchema.ID.create()}`, {
        headers: authenticated,
      })
      expect(missingResponse.status).toBe(404)
      const deleteResponse = await fetch(`${baseURL}/api/project/${extra.id}`, {
        method: "DELETE",
        headers: { ...authenticated, origin: appOrigin },
      })
      expect(deleteResponse.status).toBe(204)

      const createResponse = await fetch(`${baseURL}/api/session`, {
        method: "POST",
        headers: { ...authenticated, origin: appOrigin, "content-type": "application/json" },
        body: JSON.stringify({
          projectID: projects[0]?.id,
          model: { provider: "bymorning", id: "minimax-m2.7" },
        }),
      })
      expect(createResponse.status).toBe(201)
      const created = Schema.decodeUnknownSync(SessionSchema.Info)(await createResponse.json())

      const defaultActive = await fetch(`${baseURL}/api/session/active`, { headers: authenticated })
      expect(defaultActive.status).toBe(200)
      expect(await defaultActive.json()).toEqual({})
      const explicitActive = await fetch(`${baseURL}/api/session/active?workspace=${provisionedWorkspaceID}`, {
        headers: authenticated,
      })
      expect(explicitActive.status).toBe(200)
      expect(await explicitActive.json()).toEqual({})

      const interrupt = await fetch(`${baseURL}/api/session/${created.id}/interrupt`, {
        method: "POST",
        headers: { ...authenticated, origin: appOrigin, "content-type": "application/json" },
        body: "{}",
      })
      expect(interrupt.status).toBe(204)
      expect(await interrupt.text()).toBe("")

      const acquiredBeforeGet = sessionGraphAcquisitions
      const getResponse = await fetch(`${baseURL}/api/session/${created.id}`, { headers: authenticated })
      expect(getResponse.status).toBe(200)
      expect(sessionGraphAcquisitions).toBe(acquiredBeforeGet)
      const detail = Schema.decodeUnknownSync(SessionSchema.Detail)(await getResponse.json())
      expect(detail.id).toBe(created.id)

      const foreignCookie = await application.runPromise(
        Effect.gen(function* () {
          const foreignAccountID = AccountSchema.ID.create()
          const database = yield* Database.Service
          yield* database.use("AuthPostgresTest.foreignAccount", (db) =>
            db.insert(AccountTable).values({ id: foreignAccountID, status: "active" }),
          )
          const cookies = yield* WebCookie.Service
          const now = DateTime.nowUnsafe()
          // A correctly signed cookie whose durable Login Session record does
          // not exist is refused exactly like a revoked session.
          return yield* cookies.encrypt(
            WebCookie.Session.make({
              version: 2,
              type: "session",
              id: AuthSchema.SessionID.create(),
              accountID: foreignAccountID,
              issuedAt: now,
              expiresAt: DateTime.addDuration(now, "1 day"),
            }),
          )
        }),
      )
      const acquiredBeforeForeign = sessionGraphAcquisitions
      const foreignSession = await fetch(`${baseURL}/api/session/${created.id}`, {
        headers: { cookie: `__Host-bm_auth=${Redacted.value(foreignCookie)}` },
      })
      expect(foreignSession.status).toBe(401)
      expect(sessionGraphAcquisitions).toBe(acquiredBeforeForeign)
      const foreignActive = await fetch(`${baseURL}/api/session/active?workspace=${provisionedWorkspaceID}`, {
        headers: { cookie: `__Host-bm_auth=${Redacted.value(foreignCookie)}` },
      })
      expect(foreignActive.status).toBe(401)
      expect(sessionGraphAcquisitions).toBe(acquiredBeforeForeign)

      const acquiredBeforeInvalidOrigin = sessionGraphAcquisitions
      const invalidOrigin = await fetch(`${baseURL}/api/session/${created.id}`, {
        method: "PATCH",
        headers: { ...authenticated, origin: "https://evil.example", "content-type": "application/json" },
        body: JSON.stringify({ title: "Blocked" }),
      })
      expect(invalidOrigin.status).toBe(403)
      expect(sessionGraphAcquisitions).toBe(acquiredBeforeInvalidOrigin)

      const conflictingGet = await fetch(`${baseURL}/api/session/${created.id}?workspace=${laterWorkspaceID}`, {
        headers: authenticated,
      })
      expect(conflictingGet.status).toBe(200)
      expect(Schema.decodeUnknownSync(SessionSchema.Detail)(await conflictingGet.json()).id).toBe(created.id)

      const entryURL = `${baseURL}/api/session/${created.id}/instructions/entries/build.context`
      const putEntry = await fetch(entryURL, {
        method: "PUT",
        headers: { ...authenticated, origin: appOrigin, "content-type": "application/json" },
        body: JSON.stringify({ value: { branch: "main" } }),
      })
      expect(putEntry.status).toBe(204)
      const listEntry = await fetch(`${baseURL}/api/session/${created.id}/instructions/entries`, {
        headers: authenticated,
      })
      expect(listEntry.status).toBe(200)
      expect(
        Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Array(InstructionEntrySchema.Info) }))(
          await listEntry.json(),
        ),
      ).toEqual({ data: [{ key: "build.context", value: { branch: "main" } }] })
      const exact = await fetch(entryURL, {
        method: "PUT",
        headers: { ...authenticated, origin: appOrigin, "content-type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(InstructionEntrySchema.MaxBytes - 2) }),
      })
      expect(exact.status).toBe(204)
      const oversized = await fetch(entryURL, {
        method: "PUT",
        headers: { ...authenticated, origin: appOrigin, "content-type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(InstructionEntrySchema.MaxBytes - 1) }),
      })
      expect(oversized.status).toBe(413)
      const removeEntry = await fetch(entryURL, {
        method: "DELETE",
        headers: { ...authenticated, origin: appOrigin },
      })
      expect(removeEntry.status).toBe(204)
      const emptyEntries = await fetch(`${baseURL}/api/session/${created.id}/instructions/entries`, {
        headers: authenticated,
      })
      expect(await emptyEntries.json()).toEqual({ data: [] })
      const conflictingEntry = `${entryURL}?workspace=${laterWorkspaceID}`
      const conflictingPut = await fetch(conflictingEntry, {
        method: "PUT",
        headers: { ...authenticated, origin: appOrigin, "content-type": "application/json" },
        body: JSON.stringify({ value: "persisted workspace" }),
      })
      expect(conflictingPut.status).toBe(204)
      expect(
        await (
          await fetch(`${baseURL}/api/session/${created.id}/instructions/entries`, { headers: authenticated })
        ).json(),
      ).toEqual({ data: [{ key: "build.context", value: "persisted workspace" }] })
      const conflictingDelete = await fetch(conflictingEntry, {
        method: "DELETE",
        headers: { ...authenticated, origin: appOrigin },
      })
      expect(conflictingDelete.status).toBe(204)

      const missingID = crypto.randomUUID()
      for (const [method, url] of [
        ["GET", `${baseURL}/api/session/${missingID}/instructions/entries`],
        ["PUT", `${baseURL}/api/session/${missingID}/instructions/entries/build.context`],
        ["DELETE", `${baseURL}/api/session/${missingID}/instructions/entries/build.context`],
      ] as const) {
        const acquired = sessionGraphAcquisitions
        const response = await fetch(url, {
          method,
          headers:
            method === "PUT"
              ? { ...authenticated, origin: appOrigin, "content-type": "application/json" }
              : method === "DELETE"
                ? { ...authenticated, origin: appOrigin }
                : authenticated,
          ...(method === "PUT" ? { body: JSON.stringify({ value: "isolated" }) } : {}),
        })
        expect(response.status).toBe(404)
        expect(sessionGraphAcquisitions).toBe(acquired)
      }

      const sessions = await application.runPromise(
        Database.Service.use((database) =>
          database.use("AuthPostgresTest.sessions", (db) => db.select().from(SessionTable)),
        ),
      )
      expect(sessions).toHaveLength(1)
      expect(sessions[0]?.workspaceID).toBe(provisionedWorkspaceID)

      await application.runPromise(
        Database.Service.use((database) =>
          database.use("AuthPostgresTest.removeMembership", (db) =>
            db
              .update(UserTable)
              .set({ timeDeleted: new Date() })
              .where(eq(UserTable.workspaceId, provisionedWorkspaceID)),
          ),
        ),
      )
      const acquired = sessionGraphAcquisitions
      const unauthorizedResponse = await fetch(`${baseURL}/api/session/${created.id}`, { headers: authenticated })
      expect(unauthorizedResponse.status).toBe(401)
      expect(sessionGraphAcquisitions).toBe(acquired)
      const unauthorizedActive = await fetch(`${baseURL}/api/session/active?workspace=${provisionedWorkspaceID}`, {
        headers: authenticated,
      })
      expect(unauthorizedActive.status).toBe(401)
      expect(sessionGraphAcquisitions).toBe(acquired)
    } finally {
      // Bun's node:http close callback stays pending while its fetch sockets are retained.
      nodeServer.close()
      await application.dispose()
      await fixture.close()
    }
  }, 30_000)
})
