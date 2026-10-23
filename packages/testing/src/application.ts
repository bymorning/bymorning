/** Scoped real Application fixture shared by backend, SDK, and browser tests. */
export * as TestApp from "./application.js"

import { ByMorning, type ByMorningClient } from "@bymorning/client"
import { Actor } from "@bymorning/core/actor"
import { Auth } from "@bymorning/core/auth"
import { Cipher } from "@bymorning/core/cipher"
import { CodeInterpreter } from "@bymorning/core/code-interpreter"
import { Config } from "@bymorning/core/config"
import { Database } from "@bymorning/core/database"
import { Installation } from "@bymorning/core/installation"
import { Storage } from "@bymorning/core/storage"
import type { ServiceAccount } from "@bymorning/core/service-account"
import { User } from "@bymorning/core/user"
import { Auth as AuthSchema } from "@bymorning/schema/auth"
import type { AuthProvider as AuthProviderSchema } from "@bymorning/schema/auth-provider"
import { UserActor } from "@bymorning/schema/actor"
import type { ConfigPlugin } from "@bymorning/schema/config/plugin"
import { makeGlobalNode, makeWorkspaceNode } from "@bymorning/util/effect/app-node"
import type { GlobalProvider } from "@bymorning/util/effect/app-node"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { LayerNodePlatform } from "@bymorning/util/effect/app-node-platform"
import { NodeCrypto, NodeHttpServer } from "@effect/platform-node"
import { ConfigProvider, Context, Effect, Exit, Layer, ManagedRuntime, Redacted, Schema, Scope } from "effect"
import { HttpClient, HttpRouter, HttpServer } from "effect/unstable/http"
import { randomBytes } from "node:crypto"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Application } from "../../../packages/server/src/application.js"
import { Postgres } from "../../../packages/server/src/application/adapters/database-postgres.js"
import { load as loadConfiguration } from "../../../packages/server/src/application/configuration.js"
import { make as makeTestIdentity, type Identity } from "./identity.js"
import { WebCookie } from "../../../packages/server/src/web-cookie.js"
import { WebProvider } from "../../../packages/server/src/web-provider.js"
import { WorkspaceMap } from "../../../packages/server/src/workspace-map.js"
import { TestDatabase } from "./database.js"
import { TestLLM } from "./llm.js"

/** A resource could not be acquired for the fixture. */
export class SetupError extends Schema.TaggedError<SetupError>()("TestApp.SetupError", {
  stage: Schema.String,
  cause: Schema.Defect(),
}) {}

/** A fixture login or transport operation failed. */
export class RequestError extends Schema.TaggedError<RequestError>()("TestApp.RequestError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/** Existing process authorities exposed by the shared Application composition. */
export type Process = LayerNode.Output<ReturnType<typeof Application.graph>["process"]> | ServiceAccount.Service

/** Explicit environment selection for an independent test Application. */
export interface Input {
  readonly appOrigin?: URL
  readonly database?: TestDatabase.Interface
  readonly execution?: "docker" | "disabled"
  /** Override the local identity adapter for an external identity-provider scenario. */
  readonly identity?: GlobalProvider<WebProvider.Service, never>
  /** Domains admitted by Auth.resolve; defaults to the local fixture domain. */
  readonly allowedEmailDomains?: readonly string[]
  /**
   * Installation provisioning policy. The product default is invite-only; the
   * fixture defaults to "open" so scenarios can log in additional identities
   * without an invitation, like a commercial stage that reopened provisioning.
   * Pass "invite-only" to exercise the product default.
   */
  readonly provisioning?: "open" | "invite-only"
  /** System use notification served by auth.method; the sign-in page requires acknowledgment. */
  readonly banner?: string
  /** Override construction for provider-selection and startup-failure scenarios. */
  readonly storage?: Storage.Options
  /** Additional persisted plugins activated through the normal Workspace loader. */
  readonly plugins?: readonly ConfigPlugin.Plugin[]
  /** Fixture-owned external transport; production services still construct and authenticate requests. */
  readonly outbound?: Layer.Layer<HttpClient.HttpClient>
  /**
   * Extra host configuration entries (e.g. SESSION_IDLE_TIMEOUT) layered over
   * the fixture's otherwise empty ConfigProvider.
   */
  readonly config?: Record<string, string>
  /** Fixed cookie key so a test can craft signed cookie payloads (e.g. a legacy v1 Login Session). */
  readonly cookieKey?: string
  /**
   * Host Auth Provider seed registered at boot, mirroring the AUTH_* deployment
   * variables. Pair with a non-loopback `appOrigin` for external sign-in flows.
   */
  readonly seed?: AuthProviderSchema.Seed
  /** Credential-at-rest Cipher backend; defaults to an ephemeral local key. */
  readonly cipher?: Cipher.Backend
  /**
   * Parent of the Application's resource directory; defaults to the OS temporary
   * directory. Materialized Project plugins are imported from beneath it, and the
   * Vite module runner resolves their bare `effect` and `@bymorning/plugin`
   * imports only from a location with the repository's `node_modules` as an
   * ancestor; pass `TestApp.repository` for scenarios that load Project plugins.
   */
  readonly parent?: string
}

/** A gitignored parent inside the repository, so Vite can resolve a Project plugin's imports. */
export const repository = fileURLToPath(new URL("../.bymorning/", import.meta.url))

/** Public test entrypoints into one retained Application. */
export interface Interface {
  readonly origin: URL
  readonly directory: string
  readonly client: ByMorningClient
  /** Create another SDK client with an independent cookie jar. */
  readonly clientFor: () => ByMorningClient
  readonly llm: TestLLM.Interface
  readonly process: <A, E>(effect: Effect.Effect<A, E, Process>) => Effect.Effect<A, E>
  readonly workspace: <A, E>(
    input: User.SelectInput,
    effect: Effect.Effect<A, E, WorkspaceMap.Capabilities>,
  ) => Effect.Effect<A, E | User.AccessError>
  /** Follow the real local callback, store SDK cookies, and configure an offline Workspace before its first acquisition. */
  readonly login: (client?: ByMorningClient, identity?: Identity) => Effect.Effect<UserActor, RequestError>
}

/** Acquire a blank Application; a scenario can provision and seed it through the public entrypoints. */
export const make = (options: Input = {}) =>
  Effect.gen(function* () {
    const scope = yield* Scope.fork(yield* Effect.scope)
    return yield* acquire(options).pipe(
      Scope.provide(scope),
      Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void)),
    )
  })

const acquire = (options: Input) =>
  Effect.gen(function* () {
    const database = options.database ?? (yield* TestDatabase.shared)
    const url = yield* database.create()
    const directory = yield* Effect.acquireRelease(
      Effect.tryPromise({
        // Canonicalize: tmpdir() is a symlink on macOS (/var -> /private/var), and
        // subprocesses such as `pwd` report the resolved path.
        try: async () => {
          const parent = options.parent ?? tmpdir()
          await mkdir(parent, { recursive: true })
          return realpath(await mkdtemp(path.join(parent, "bymorning-app-test-")))
        },
        catch: (cause) => new SetupError({ stage: "directory", cause }),
      }),
      (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
    )
    const llm = yield* TestLLM.make()
    const identities = [
      {
        subject: AuthSchema.Sub.make("test-owner"),
        email: AuthSchema.Email.make("owner@bymorning.ai"),
      },
      {
        subject: AuthSchema.Sub.make("test-member"),
        email: AuthSchema.Email.make("member@bymorning.ai"),
      },
    ]
    // Auth Local Login admits one fixed identity per Application. The holder
    // starts at identities[0] and login() points it at the selected identity
    // before opening, so sequential owner/member logins keep working.
    const local = { subject: identities[0]!.subject, email: identities[0]!.email }
    const appOrigin = options.appOrigin ?? new URL("http://localhost:3000")
    const selected = Postgres.node({ url, maxConnections: 4 })
    const storage: Storage.Options = options.storage ?? {
      configure: (editor) => {
        const provider = Storage.filesystem({ directory: path.join(directory, "storage") })
        editor.add(provider)
        editor.default.set(provider.id)
      },
    }
    const selectedStorage = Storage.configured(storage)
    const identityFixture = makeTestIdentity(identities)
    const installation =
      options.execution === "docker"
        ? [
            yield* loadConfiguration(
              fileURLToPath(new URL("../../../app/host/bymorning.docker.jsonc", import.meta.url)),
              {},
            ),
          ]
        : []
    const graph = Application.graph({
      settings: {
        appOrigin,
        host: "127.0.0.1",
        port: 0,
        allowedEmailDomains: options.allowedEmailDomains ?? ["bymorning.ai"],
        cookiePolicy: WebCookie.local,
        // Each test Application owns its database, so its Cipher key is ephemeral
        // unless the scenario supplies a durable backend.
        cipher:
          options.cipher ??
          (yield* Cipher.localBackend(Redacted.make(randomBytes(32).toString("base64url"))).pipe(
            Effect.provide(NodeCrypto.layer),
            Effect.mapError((cause) => new SetupError({ stage: "cipher", cause })),
          )),
        directory,
        installPackage: false,
        configuration: installation,
        local,
        ...(options.seed === undefined ? {} : { seed: options.seed }),
        ...(options.banner === undefined ? {} : { banner: options.banner }),
      },
      deps: {
        database: selected,
        storage: selectedStorage,
        identity: options.identity ?? identityFixture.node,
        cookie: WebCookie.makeNode(Redacted.make(options.cookieKey ?? randomBytes(32).toString("base64url"))),
      },
    })
    const configuration = ConfigProvider.layer(ConfigProvider.fromUnknown(options.config ?? {}))
    const services = LayerNode.compile(LayerNode.group([graph.root, graph.process]), {
      replacements: options.outbound === undefined ? [] : [LayerNodePlatform.httpClient.replace(options.outbound)],
    })
    const runtime = yield* Effect.acquireRelease(
      Effect.sync(() =>
        ManagedRuntime.make(
          HttpRouter.serve(services, { disableListenLog: true, disableLogger: true }).pipe(
            Layer.provideMerge(NodeHttpServer.layer(createServer, { host: "127.0.0.1", port: 0 })),
            Layer.provide(configuration),
          ),
        ),
      ),
      (runtime) => runtime.disposeEffect,
    )
    const context = yield* runtime.contextEffect.pipe(
      Effect.mapError((cause) => new SetupError({ stage: "application", cause })),
      Effect.catchDefect((cause) => new SetupError({ stage: "application", cause })),
    )
    const origin = new URL(HttpServer.formatAddress(Context.get(context, HttpServer.HttpServer).address))
    const process: Interface["process"] = (effect) =>
      effect.pipe(Effect.provide(context), Effect.provide(configuration))
    if ((options.provisioning ?? "open") === "open") {
      yield* process(Installation.Service.use((service) => service.policy.update({ provisioning: "open" }))).pipe(
        Effect.mapError((cause) => new SetupError({ stage: "application", cause })),
      )
    }
    const workspaces = Context.get(context, WorkspaceMap.Service)
    const workspace = ((input: User.SelectInput, effect: Effect.Effect<any, any, any>) =>
      process(User.Service.use((users) => users.select(input))).pipe(
        Effect.flatMap((actor) =>
          effect.pipe(Effect.provide(workspaces.get(actor.properties).pipe(Layer.provide(configuration)))),
        ),
      )) as Interface["workspace"]
    const makeTransport = (): typeof globalThis.fetch => {
      const cookies = new Map<string, string>()
      return async (input, init) => {
        const request = new Request(input, init)
        const headers = new Headers(request.headers)
        if (!headers.has("cookie")) headers.set("cookie", [...cookies.values()].join("; "))
        headers.set("origin", appOrigin.origin)
        const response = await fetch(new Request(request, { headers }))
        for (const cookie of response.headers.getSetCookie()) {
          const pair = cookie.split(";")[0]
          const name = pair?.slice(0, pair.indexOf("="))
          if (pair === undefined || name === undefined) continue
          if (/max-age=0(?:;|$)/i.test(cookie)) cookies.delete(name)
          else cookies.set(name, pair)
        }
        return response
      }
    }
    const transports = new WeakMap<object, typeof globalThis.fetch>()
    const clientFor = () => {
      const transport = makeTransport()
      const result = ByMorning.make({ baseUrl: origin.href, fetch: transport })
      transports.set(result, transport)
      return result
    }
    const client = clientFor()
    const prepared = new Set<string>()
    const login = Effect.fn("TestApp.login")(function* (
      loginClient: ByMorningClient = client,
      selectedIdentity: Identity = identities[0]!,
    ) {
      let identity = identities[0]!
      yield* Effect.tryPromise({
        try: async () => {
          // Core Auth serves Local Login itself now; the WebProvider fixture
          // stays only as the (unused by auth) process identity dependency.
          local.subject = selectedIdentity.subject
          local.email = selectedIdentity.email
          const transport = transports.get(loginClient)
          if (transport === undefined) throw new Error("Unknown TestApp client")
          const start = await transport(new URL("/auth/login", origin), { redirect: "manual" })
          const location = start.headers.get("location")
          if (start.status !== 302 || location === null) throw new Error("Local login did not redirect")
          const callback = new URL(location)
          const code = callback.searchParams.get("code")
          if (code === null) throw new Error("Local login did not issue a code")
          identity = selectedIdentity
          const complete = await transport(new URL(callback.pathname + callback.search, origin), { redirect: "manual" })
          if (complete.status !== 303) throw new Error("Local login did not authenticate")
        },
        catch: (cause) => new RequestError({ message: "Local login failed", cause }),
      })
      const account = yield* process(
        Auth.Service.use((auth) =>
          auth.resolve(
            AuthSchema.Assertion.make({
              provider: AuthSchema.Provider.make("local"),
              subject: identity.subject,
              verifiedEmail: identity.email,
            }),
          ),
        ),
      ).pipe(Effect.mapError((cause) => new RequestError({ message: "Account provisioning failed", cause })))
      const owner = yield* process(User.Service.use((users) => users.select({ account }))).pipe(
        Effect.mapError((cause) => new RequestError({ message: "Membership selection failed", cause })),
      )
      if (!prepared.has(owner.properties.workspaceID)) {
        // Bootstrap through the same member declarations as WorkspaceMap without
        // activating its complete graph. The Config service needs a live, volatile
        // member Bus only to observe its own update while this layer is retained.
        const config = LayerNode.bind(Config.node, [
          Actor.binding.replace(
            makeWorkspaceNode({
              service: Actor.Binding.Service,
              layer: Layer.succeed(Actor.Binding.Service, owner.properties),
              deps: [],
            }),
          ),
          Database.node.replace(selected),
        ])
        // Configure persisted bootstrap state before the full Workspace graph activates automatic remote integrations.
        yield* Config.Service.use((config) =>
          Effect.gen(function* () {
            const current = yield* config.get
            yield* config.update(
              {
                ...current,
                plugins: [
                  {
                    package: fileURLToPath(new URL("./model-plugin.ts", import.meta.url)),
                    options: { endpoint: llm.url },
                  },
                  ...(options.plugins ?? []),
                ],
              },
              owner,
            )
          }),
        ).pipe(
          Effect.provide(LayerNode.compile(config).pipe(Layer.provide(configuration))),
          Effect.mapError((cause) => new RequestError({ message: "Workspace configuration failed", cause })),
        )
        prepared.add(owner.properties.workspaceID)
      }
      return owner
    })
    // Verify before Application disposal can turn an unfinished model request into a cancellation.
    yield* Effect.addFinalizer(() => llm.verify().pipe(Effect.orDie))
    return { origin, directory, client, clientFor, llm, process, workspace, login } satisfies Interface
  })
