export * as Application from "./application.js"

import { Database } from "@bymorning/core/database"
import { Storage } from "@bymorning/core/storage"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { Duration, Effect, Layer, Redacted, Schedule } from "effect"
import { WorkspaceConfig } from "@bymorning/core/config"
import type { Config as ConfigSchema } from "@bymorning/schema/config"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { NodeHttpServer } from "@effect/platform-node"
import http from "node:http"
import https from "node:https"
import { cwd, env } from "node:process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WebCookie } from "./web-cookie.js"
import { WebProvider } from "./web-provider.js"

export interface Dependencies<EDatabase = never, EStorage = never, EIdentity = never, ECookie = never> {
  readonly database: LayerNode.Provider<Database.Service, EDatabase, typeof tags.values.global>
  readonly storage: LayerNode.Provider<Storage.Service, EStorage, typeof tags.values.global>
  readonly identity: LayerNode.Provider<WebProvider.Service, EIdentity, typeof tags.values.global>
  readonly cookie: LayerNode.Provider<WebCookie.Service, ECookie, typeof tags.values.global>
}
/** PEM material for an HTTPS listener. Only the private key is redacted. */
export interface TLS {
  readonly key: Redacted.Redacted<string>
  readonly cert: string
}
export interface Settings {
  readonly configuration?: readonly ConfigSchema.Entry[]
  readonly appOrigin: URL
  readonly host: string
  readonly port: number
  /** Serve HTTPS on the listener with this certificate instead of plain HTTP. */
  readonly tls?: TLS
  readonly allowedEmailDomains: readonly string[]
  readonly cookiePolicy: WebCookie.Policy
  /** Credential-at-rest Cipher backend. Required: each host must decide. */
  readonly cipher: Cipher.Backend
  readonly directory?: string
  readonly installPackage?: boolean
  /** Fixed Local Login identity. Honored only on loopback app origins. */
  readonly local?: Auth.Local
  /** Host Auth Provider seed for init and legacy login callback matching. */
  readonly seed?: AuthProvider.Seed
  /** Operator-supplied setup token (SETUP_TOKEN). Used on first boot and accepted as an override while configured. */
  readonly setupToken?: Redacted.Redacted<string>
  /** System use notification text shown on the sign-in page; requires acknowledgment before continuing. */
  readonly banner?: string
  /** Proxy IPs or CIDRs whose X-Forwarded-For chains are trusted when throttling public auth endpoints. */
  readonly trustedProxies?: readonly string[]
}
export interface Input<EDatabase = never, EStorage = never, EIdentity = never, ECookie = never> {
  readonly settings: Settings
  readonly deps: Dependencies<EDatabase, EStorage, EIdentity, ECookie>
}

import { makeGlobalNode, tags } from "@bymorning/util/effect/app-node"
import { Account } from "@bymorning/core/account"
import { Audit } from "@bymorning/core/audit"
import { User } from "@bymorning/core/user"
import { Auth } from "@bymorning/core/auth"
import { AuthProvider } from "@bymorning/core/auth-provider"
import { Installation } from "@bymorning/core/installation"
import { Cipher } from "@bymorning/core/cipher"
import { Project } from "@bymorning/core/project"
import { Workspace } from "@bymorning/core/workspace"
import { OAuth } from "@bymorning/core/oauth"
import { IntegrationOAuthCallback } from "@bymorning/core/integration-oauth-callback"
import { LLMGateway } from "@bymorning/gateway/llm-gateway"
import { ToolGateway } from "@bymorning/gateway/tool-gateway"
import { ServiceAccount } from "@bymorning/core/service-account"
import { Command } from "@bymorning/core/command"
import { Reference } from "@bymorning/core/reference"
import { LayerNodePlatform } from "@bymorning/util/effect/app-node-platform"
import { EventHub } from "./event-hub.js"
import { LLMGatewayLease } from "./llm-gateway-lease.js"
import { routes } from "./routes.js"
import { WorkspaceEventBroadcaster } from "./workspace-event-broadcaster.js"
import { WorkspaceMap } from "./workspace-map.js"
import { WorkspaceRecovery } from "./application/recovery.js"
import { AuditPrune } from "./application/audit-prune.js"
import { TaskScheduler } from "./application/scheduler.js"
import { WorkspaceMapGraph } from "./workspace-map/graph.js"
import { ToolGatewayRuntime } from "./tool-gateway-runtime.js"

export interface Config {
  readonly configuration?: readonly ConfigSchema.Entry[]
  readonly appOrigin: URL
  readonly allowedEmailDomains?: readonly string[]
  readonly cookiePolicy?: WebCookie.Policy
  readonly directory?: string
  readonly installPackage?: boolean
  /** Fixed Local Login identity. Honored only on loopback app origins. */
  readonly local?: Auth.Local
  /** Host Auth Provider seed for init and legacy login callback matching. */
  readonly seed?: AuthProvider.Seed
  /** Operator-supplied setup token (SETUP_TOKEN). Used on first boot and accepted as an override while configured. */
  readonly setupToken?: Redacted.Redacted<string>
  /** Credential-at-rest Cipher backend. Required: each host must decide (KMS in AWS, key file locally). */
  readonly cipher: Cipher.Backend
  /** System use notification text shown on the sign-in page; requires acknowledgment before continuing. */
  readonly banner?: string
  /** Proxy IPs or CIDRs whose X-Forwarded-For chains are trusted when throttling public auth endpoints. */
  readonly trustedProxies?: readonly string[]
}

/** Build the configured process graph and its stable application replacement seams. */
export const process = <EDatabase = never, EStorage = never, EIdentity = never, ECookie = never>(
  config: Config,
  deps: Partial<Dependencies<EDatabase, EStorage, EIdentity, ECookie>> &
    Pick<Dependencies<EDatabase, EStorage, EIdentity, ECookie>, "identity">,
) => {
  const database = Database.node
  const storage = Storage.node
  const cipher = Cipher.node
  const plugin = {
    app: {
      name: "ByMorning",
      version: env.BYMORNING_VERSION ?? "0.0.0",
      channel: env.BYMORNING_CHANNEL ?? "local",
    },
    directory: config.directory,
    installPackage: config.installPackage,
  }
  const pluginRuntime = LLMGatewayLease.runtimeNode(database, storage, plugin, config.configuration ?? [])
  const cookie = WebCookie.node
  const provider = WebProvider.node
  const account = Account.node
  const user = User.node
  const auth = Auth.node
  const authProvider = AuthProvider.node
  const installation = Installation.node
  const audit = Audit.node
  const authProviderBoot = makeGlobalNode({
    name: "@bymorning/core/AuthProvider.init",
    layer: Layer.effectDiscard(
      AuthProvider.Service.pipe(
        Effect.flatMap((service) =>
          service.init({
            ...(config.seed === undefined ? {} : { seed: config.seed }),
            ...(config.setupToken === undefined ? {} : { token: config.setupToken }),
            tokenFile: join(config.directory ?? tmpdir(), "setup-token"),
          }),
        ),
        Effect.orDie,
      ),
    ),
    deps: [authProvider],
  })
  // Re-encrypt legacy plaintext secret columns before traffic is served. A
  // migration failure never crashes the host: reads still accept legacy
  // plaintext, writes still encrypt (failing closed), and the next boot
  // retries. The error line is the installer's alarm signature.
  const cipherBoot = makeGlobalNode({
    name: "@bymorning/core/Cipher.migrate",
    layer: Layer.effectDiscard(
      Cipher.migrate.pipe(
        Effect.catchCause((cause) =>
          Effect.logError("Cipher migration failed; legacy plaintext secrets remain until a successful boot", {
            cause: String(cause),
          }),
        ),
      ),
    ),
    deps: [cipher, database],
  })
  // Durable storage purge: drain persisted intents at boot, then on an
  // interval. Each pass logs and retains a failed intent for the next pass.
  const purgeBoot = makeGlobalNode({
    name: "@bymorning/core/Project.purge",
    layer: Layer.effectDiscard(
      Effect.gen(function* () {
        const pass = Project.drainPurge.pipe(
          Effect.catchCause((cause) => Effect.logError("Project.purge drain failed", { cause: String(cause) })),
        )
        yield* pass
        yield* pass.pipe(Effect.repeat(Schedule.spaced(Duration.minutes(5))), Effect.forkScoped)
      }),
    ),
    deps: [database, storage, audit],
  })
  const workspace = Workspace.node
  const oauth = OAuth.node
  const serviceAccount = ServiceAccount.node
  const llmGateway = LLMGateway.node
  const oauthCallback = IntegrationOAuthCallback.node
  const broadcaster = WorkspaceEventBroadcaster.node
  const eventHub = EventHub.node
  const databaseBinding =
    deps?.database === undefined ? Database.node.replace(Database.configured) : Database.node.replace(deps.database)
  const storageBinding =
    deps?.storage === undefined ? Storage.node.replace(Storage.defaultNode) : Storage.node.replace(deps.storage)
  const identityBinding = WebProvider.node.replace(deps.identity)
  const cookieBinding =
    deps?.cookie === undefined ? WebCookie.node.replace(WebCookie.configured) : WebCookie.node.replace(deps.cookie)
  // Local Login is the second Auth adapter. It is installed only on loopback
  // app origins (the same rule handlers/auth.ts reports through auth.method),
  // so non-loopback deployments keep rejecting { type: "local" } with
  // local-disabled even when a local identity is configured.
  const isLoopback =
    config.appOrigin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(config.appOrigin.hostname)
  const local = config.local !== undefined && isLoopback ? config.local : undefined
  const bindings = [
    WorkspaceConfig.node.replace(WorkspaceConfig.configured(config.configuration ?? [])),
    databaseBinding,
    storageBinding,
    Cipher.node.replace(Cipher.configured(config.cipher)),
    identityBinding,
    cookieBinding,
    LLMGateway.lease.replace(LLMGatewayLease.node(pluginRuntime)),
    Audit.node.replace(Audit.makeNode({ database })),
    Auth.node.replace(Auth.makeNode({ database, storage }, config.allowedEmailDomains, local)),
    IntegrationOAuthCallback.node.replace(IntegrationOAuthCallback.configured(config.appOrigin)),
    Command.node.replace(Command.configured(config.directory ?? cwd())),
    Reference.node.replace(
      Reference.configured(
        config.directory === undefined ? "/tmp/opencode/references" : `${config.directory}/references`,
      ),
    ),
  ]
  const workspaceRuntime = WorkspaceMapGraph.production(
    {
      database,
      storage,
      broadcaster,
      eventHub,
      oauthCallback,
      httpClient: LayerNodePlatform.httpClient,
      directory: config.directory,
      installPackage: config.installPackage,
      pluginRuntime,
    },
    bindings,
    plugin,
  )
  const workspaces = WorkspaceMap.node(workspaceRuntime)
  const toolRuntime = ToolGatewayRuntime.node(workspaces)
  const toolGateway = makeGlobalNode({
    service: ToolGateway.Service,
    layer: ToolGateway.layer,
    deps: [toolRuntime],
  })
  const recovery = WorkspaceRecovery.nodes(workspaces, database)
  const scheduler = TaskScheduler.nodes(workspaces, database)
  // Retention pruning runs at boot and daily; a failed run is logged and retried on the next tick.
  const auditPrune = AuditPrune.boot(audit)
  const router = routes(config.appOrigin.origin, {
    workspaces,
    cookie,
    provider,
    oauthCallback,
    database,
    storage,
    account,
    user,
    auth,
    authProvider,
    workspace,
    oauth,
    llmGateway,
    toolGateway,
    toolRuntime,
    cookiePolicy: config.cookiePolicy,
    // Invitations admit the same domains a sign-in can complete with: enabled
    // Auth Providers always, plus the Local Login domains only when Local Login
    // is actually installed (loopback origins).
    invitationDomains: local === undefined ? [] : (config.allowedEmailDomains ?? []),
    ...(config.banner === undefined ? {} : { banner: config.banner }),
    ...(config.trustedProxies === undefined ? {} : { trustedProxies: config.trustedProxies }),
    ...(config.seed === undefined ? {} : { seed: { issuer: config.seed.issuer, clientID: config.seed.clientID } }),
  })

  return {
    process: LayerNode.bind(
      LayerNode.group([
        database,
        storage,
        cipher,
        account,
        user,
        auth,
        authProvider,
        installation,
        audit,
        workspace,
        workspaces,
        oauth,
      ]),
      bindings,
    ),
    root: LayerNode.bind(
      LayerNode.group([
        // Storage must stay first: its provider initialization has to fail startup
        // before any database-backed boot begins acquiring.
        storage,
        database,
        cipher,
        router,
        recovery.boot,
        scheduler.boot,
        auditPrune,
        authProviderBoot,
        cipherBoot,
        purgeBoot,
        serviceAccount,
        llmGateway,
        toolGateway,
        toolRuntime,
      ]),
      bindings,
    ),
    workspaces,
    routes: router,
    recovery,
    scheduler,
    adapters: { oauthCallback, broadcaster, eventHub, cookie, provider, httpClient: LayerNodePlatform.httpClient },
    workspaceRuntime,
  }
}

/** Construct one application recipe with host adapters bound once. */
export const graph = <EDatabase = never, EStorage = never, EIdentity = never, ECookie = never>(
  input: Input<EDatabase, EStorage, EIdentity, ECookie>,
) => {
  const selected = process(input.settings, input.deps)
  // Adapter selection is captured by the process recipe and inherited by member construction.
  return {
    // Storage is an explicit startup root: its provider initialization completes
    // before recovery begins.
    root: selected.root,
    process: selected.process,
  }
}
export const node = <EDatabase = never, EStorage = never, EIdentity = never, ECookie = never>(
  input: Input<EDatabase, EStorage, EIdentity, ECookie>,
) => graph(input).root
/**
 * FIPS 140-approved suites only: AES-GCM with ECDHE key exchange for TLS 1.2,
 * and the AES-GCM TLS 1.3 suites. ChaCha20 and CBC suites are excluded.
 */
export const ciphers = [
  "TLS_AES_256_GCM_SHA384",
  "TLS_AES_128_GCM_SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES128-GCM-SHA256",
].join(":")

/** Node listener for the settings: HTTPS with `tls`, otherwise plain HTTP. */
export const listener = (tls?: TLS) =>
  tls === undefined
    ? http.createServer()
    : https.createServer({
        key: Redacted.value(tls.key),
        cert: tls.cert,
        minVersion: "TLSv1.2",
        ciphers,
        honorCipherOrder: true,
      })

/** The listening Application as a Layer; its output includes the bound `HttpServer` (address, for tests). */
export const layer = <A, E>(root: LayerNode.Graph<A, E>, settings: Settings) =>
  HttpRouter.serve(LayerNode.compile(root)).pipe(
    HttpServer.withLogAddress,
    Layer.provideMerge(
      NodeHttpServer.layer(() => listener(settings.tls), { host: settings.host, port: settings.port }),
    ),
  )

export const serve = <A, E>(root: LayerNode.Graph<A, E>, settings: Settings) => Layer.launch(layer(root, settings))
