/**
 * Startup resolution for the one Gateway host. The deployer binds the image to
 * a cloud with environment variables; `resolve` reads them through Effect
 * `Config`, selects the storage provider and credential key backend named by
 * `STORAGE_PROVIDER` and `CIPHER_BACKEND`, enforces the startup rules from
 * app/host/README.md, and returns the Application input. `Host` is not an
 * Effect service: the entries call `resolve` once and hand the result to
 * `Application.serve`, and run as a process through `launch`.
 */
export * as Host from "./host.js"

import { Storage } from "@bymorning/core/storage"
import type { Auth } from "@bymorning/core/auth"
import type { Cipher } from "@bymorning/core/cipher"
import type { AuthProvider } from "@bymorning/schema/auth-provider"
import type { Config as Installation } from "@bymorning/schema/config"
import { makeGlobalNode, type GlobalProvider } from "@bymorning/util/effect/app-node"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { Cause, Config, ConfigProvider, Effect, Layer, Option, Schema } from "effect"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Application } from "../../../packages/server/src/application.js"
import { Postgres } from "../../../packages/server/src/application/adapters/database-postgres.js"
import * as Configuration from "../../../packages/server/src/application/configuration.js"
import { serverConfig } from "../../../packages/server/src/server-config.js"
import { serverObservability } from "../../../packages/server/src/server-observability.js"
import { WebCookie } from "../../../packages/server/src/web-cookie.js"
import { WebProvider } from "../../../packages/server/src/web-provider.js"

export { MigrationError } from "./migrate.js"

/** A startup setting is missing, malformed, or violates a deployment rule. Names the setting; never echoes a value. */
export class ConfigError extends Schema.TaggedError<ConfigError>()("Host.ConfigError", {
  setting: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `${this.setting}: ${this.reason}`
  }
}

/** Builds one storage provider from its companion settings; keyed by the `STORAGE_PROVIDER` value. */
export type StorageFactory = Effect.Effect<Storage.Provider, ConfigError | Config.ConfigError>

/** Builds one credential key backend from its companion settings; keyed by the `CIPHER_BACKEND` value. */
export type CipherFactory = Effect.Effect<Cipher.Backend, ConfigError | Config.ConfigError | Cipher.UnavailableError>

/** PostgreSQL connection the Application opens. */
export type Database = Parameters<typeof Postgres.node>[0]

/** Supplies the database connection; the default reads DATABASE_URL and DATABASE_CA. */
export type DatabaseFactory<R = never> = Effect.Effect<Database, ConfigError | Config.ConfigError, R>

/** What one entry offers a deployment. Production and development entries differ only here. */
export interface Selection<R = never> {
  /** Storage providers by `STORAGE_PROVIDER` value. */
  readonly storage: Record<string, StorageFactory>
  /** Credential key backends by `CIPHER_BACKEND` value. */
  readonly cipher: Record<string, CipherFactory>
  /** Database supplier; omit for DATABASE_URL (required) with optional DATABASE_CA. */
  readonly database?: DatabaseFactory<R>
  /** Process identity dependency; production fails closed (`identity`). */
  readonly identity: GlobalProvider<WebProvider.Service, never>
  /**
   * Fixed Local Login identity. Only the development entry sets it; its
   * presence marks a development selection, where the Plugin cache lives under
   * BYMORNING_DATA_DIR and Plugin packages may be installed.
   */
  readonly local?: Auth.Local
  /** Settings read when the process environment does not supply them. */
  readonly defaults?: Record<string, string>
}

/**
 * Production process identity. WebProvider no longer hosts OIDC: AUTH_* may
 * seed an Auth Provider through Application settings and Core Auth serves
 * registered providers from the database. This dependency stays only as the
 * (unused by auth) composition dependency and fails closed.
 */
export const identity = makeGlobalNode({
  service: WebProvider.Service,
  layer: Layer.succeed(
    WebProvider.Service,
    WebProvider.Service.of({
      start: () => Effect.fail(new WebProvider.ProviderError({ operation: "start", reason: "discovery" })),
      complete: () => Effect.fail(new WebProvider.ProviderError({ operation: "complete", reason: "exchange" })),
    }),
  ),
  deps: [],
}) satisfies GlobalProvider<WebProvider.Service, never>

/** Azure sovereign cloud selector; required whenever an `azure-*` backend is selected. */
export const Cloud = Schema.Literals(["AzureCloud", "AzureUSGovernment"])

/** Production endpoints per Azure cloud. Emulators reach backends through explicit client options, never host settings. */
export const clouds = {
  AzureCloud: {
    authorityHost: "https://login.microsoftonline.com",
    blob: "blob.core.windows.net",
    vault: "vault.azure.net",
  },
  AzureUSGovernment: {
    authorityHost: "https://login.microsoftonline.us",
    blob: "blob.core.usgovcloudapi.net",
    vault: "vault.usgovcloudapi.net",
  },
} as const

/**
 * Accept only a bare production HTTPS endpoint under the cloud's DNS suffix:
 * no credentials, port, query, fragment, or unexpected path.
 */
export const endpoint = (value: string, setting: string, suffix: string, pathname: RegExp) =>
  Effect.try({
    try: () => {
      const url = new URL(value)
      const name = url.hostname.slice(0, -(suffix.length + 1))
      if (
        url.protocol !== "https:" ||
        url.username !== "" ||
        url.password !== "" ||
        url.port !== "" ||
        value.includes("?") ||
        value.includes("#") ||
        !url.hostname.endsWith(`.${suffix}`) ||
        !/^[a-z0-9][a-z0-9-]*$/.test(name) ||
        !pathname.test(url.pathname) ||
        value.includes("\\") ||
        /\s/.test(value) ||
        value !== `${url.origin}${url.pathname === "/" && !value.endsWith("/") ? "" : url.pathname}`
      )
        throw new Error("Invalid endpoint")
      return url
    },
    catch: () => new ConfigError({ setting, reason: `must be a production https endpoint under ${suffix}` }),
  })

const kubernetes = "@bymorning/plugin-code-interpreter-kubernetes"
const digest = /^[^\s@]+@sha256:[0-9a-f]{64}$/

/**
 * Selecting the Kubernetes Code Interpreter without a digest-pinned execution
 * image in the installation document refuses startup instead of failing at the
 * first execution. (`requireImageDigest: false` is the plugin's explicit
 * local-testing opt-out.)
 */
export const checkInterpreter = (info: Installation.Info) => {
  if (info.code_interpreter?.implementation !== "kubernetes") return Effect.void
  const entry = info.plugins?.find((plugin) => typeof plugin !== "string" && plugin.package === kubernetes)
  const options = typeof entry === "object" ? entry.options : undefined
  const image = options?.image
  const pinned = options?.requireImageDigest === false || (typeof image === "string" && digest.test(image))
  return pinned
    ? Effect.void
    : Effect.fail(
        new ConfigError({
          setting: "code_interpreter.image",
          reason: `the kubernetes Code Interpreter needs a digest-pinned image in the ${kubernetes} plugin options`,
        }),
      )
}

/** Local Login and development cookies apply only to plain-HTTP loopback origins, as in Core Auth. */
const isLoopback = (origin: URL) =>
  origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)

/** Read one selector and require it to name an offered implementation. */
const select = <A>(setting: string, table: Record<string, A>) =>
  Effect.gen(function* () {
    const offered = Object.keys(table).join(", ")
    const value = yield* Config.option(Config.string(setting))
    if (Option.isNone(value)) return yield* new ConfigError({ setting, reason: `is required; one of ${offered}` })
    const selected = table[value.value]
    if (selected === undefined || !Object.hasOwn(table, value.value))
      return yield* new ConfigError({ setting, reason: `is not one of ${offered}` })
    return selected
  })

/**
 * AWS_USE_FIPS_ENDPOINT is read by every AWS SDK client and by Core's Bedrock
 * routing, which both accept exactly "true" or "false" (the SDK throws on any
 * other value at the first request). Unset is "false". A GovCloud Region
 * (`us-gov-*`) requires "true" whatever the selection, because Bedrock traffic
 * from an Azure deployment also crosses that partition.
 */
const checkFIPS = (fips: Option.Option<string>, region: Option.Option<string>) =>
  Effect.gen(function* () {
    const value = Option.getOrElse(fips, () => "false")
    if (value !== "true" && value !== "false")
      return yield* new ConfigError({ setting: "AWS_USE_FIPS_ENDPOINT", reason: 'must be "true" or "false"' })
    if (Option.isSome(region) && region.value.startsWith("us-gov-") && value !== "true")
      return yield* new ConfigError({
        setting: "AWS_USE_FIPS_ENDPOINT",
        reason: 'must be "true" when AWS_REGION is a GovCloud Region (us-gov-*)',
      })
    return value
  })

/**
 * Optional listener certificate. When both TLS_CERT and TLS_KEY are set the
 * gateway serves HTTPS so the load balancer hop is encrypted; setting one
 * without the other is a startup error. Absent, the listener is plain HTTP.
 */
const tls = Config.all({
  cert: Config.schema(Schema.NonEmptyString, "TLS_CERT"),
  key: Config.redacted("TLS_KEY"),
}).pipe(Config.option)

/**
 * Optional hardening settings. SETUP_TOKEN supplies the installation setup
 * token as a secret instead of the generated owner-read-only file.
 * LOGIN_BANNER is the NIST 3.1.9 system use notification acknowledged before
 * sign-in. TRUSTED_PROXIES lists the load balancer hops whose X-Forwarded-For
 * chains are trusted when throttling the public authentication endpoints.
 */
const hardening = Config.all({
  setupToken: Config.option(Config.redacted("SETUP_TOKEN")),
  banner: Config.option(Config.string("LOGIN_BANNER")),
  trustedProxies: Config.option(Config.string("TRUSTED_PROXIES")),
})

/** DATABASE_URL with optional DATABASE_CA (PEM) verifying a TLS PostgreSQL server. */
const database: DatabaseFactory = Config.all({
  url: Config.redacted("DATABASE_URL"),
  ca: Config.option(Config.redacted("DATABASE_CA")),
}).pipe(Config.map(({ url, ca }) => ({ url, ...(Option.isSome(ca) ? { ca: ca.value } : {}) })))

/**
 * A Microsoft AUTH_ISSUER must be a tenant v2.0 issuer of the selected cloud's
 * authority (either known authority when AZURE_CLOUD is unset); every issuer
 * must be a bare https URL.
 */
const checkIssuer = (seed: AuthProvider.Seed, cloud: Option.Option<typeof Cloud.Type>) =>
  Effect.try({
    try: () => {
      const issuer = new URL(seed.issuer)
      const authorities: ReadonlyArray<string> = Option.isSome(cloud)
        ? [clouds[cloud.value].authorityHost]
        : Object.values(clouds).map((entry) => entry.authorityHost)
      if (
        issuer.protocol !== "https:" ||
        issuer.username !== "" ||
        issuer.password !== "" ||
        seed.issuer.includes("?") ||
        seed.issuer.includes("#") ||
        (seed.kind === "microsoft" &&
          (!authorities.includes(issuer.origin) || !/^\/[a-zA-Z0-9.-]+\/v2\.0$/.test(issuer.pathname)))
      )
        throw new Error("Invalid issuer")
    },
    catch: () =>
      new ConfigError({
        setting: "AUTH_ISSUER",
        reason:
          seed.kind === "microsoft"
            ? "must be a tenant v2.0 issuer of the AZURE_CLOUD authority"
            : "must be a bare https issuer URL",
      }),
  })

const withDefaults = <A, E, R>(defaults: Record<string, string> | undefined, effect: Effect.Effect<A, E, R>) =>
  defaults === undefined
    ? effect
    : Effect.gen(function* () {
        const current = yield* ConfigProvider.ConfigProvider
        return yield* effect.pipe(
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.orElse(current, ConfigProvider.fromUnknown(defaults)),
          ),
        )
      })

/**
 * Decode the deployment's environment into Application input, or fail with
 * the first violated setting. Nothing is opened here: providers, the cipher
 * backend, and the database connection are acquired by the Application.
 *
 * @param selection - The implementations this entry offers.
 * @returns Application settings and dependencies for `Application.serve`.
 */
export const resolve = <R = never>(selection: Selection<R>) =>
  withDefaults(
    selection.defaults,
    Effect.gen(function* () {
      const storage = yield* select("STORAGE_PROVIDER", selection.storage)
      const cipher = yield* select("CIPHER_BACKEND", selection.cipher)
      const resolved = yield* serverConfig
      const { appOrigin } = resolved
      const seed = "auth" in resolved ? resolved.auth : undefined
      const common = yield* Config.all({
        cookieKey: Config.redacted("WEB_COOKIE_KEY"),
        port: Config.port("PORT").pipe(Config.withDefault(3210)),
        host: Config.string("HOST").pipe(Config.withDefault("0.0.0.0")),
        tls,
        hardening,
        cloud: Config.option(Config.schema(Cloud, "AZURE_CLOUD")),
        // AWS_REGION is optional here: the AWS selections require it for their
        // own clients; the Azure selections set it only for Bedrock.
        region: Config.option(Config.schema(Schema.NonEmptyString, "AWS_REGION")),
        fips: Config.option(Config.string("AWS_USE_FIPS_ENDPOINT")),
        dataDirectory: Config.option(Config.schema(Schema.NonEmptyString, "BYMORNING_DATA_DIR")),
        // BYMORNING_CONFIG selects the installation document; the image ships
        // bymorning.jsonc, bymorning.cui.jsonc, and bymorning.azure.jsonc beside
        // the bundle. A set path that cannot be read or decoded fails startup —
        // there is no fallback.
        configFile: Config.option(Config.schema(Schema.NonEmptyString, "BYMORNING_CONFIG")),
      })
      const development = selection.local !== undefined
      // Only the development selection serves a plain-HTTP loopback origin; the
      // image is always behind TLS (its own listener or the ingress) and keeps
      // the Secure cookie policy.
      const loopback = development && isLoopback(appOrigin)
      if (appOrigin.protocol !== "https:" && !loopback)
        return yield* new ConfigError({
          setting: "APP_ORIGIN",
          reason: development ? "must be an https origin unless loopback" : "must be an https origin",
        })
      const fips = yield* checkFIPS(common.fips, common.region)
      if (seed !== undefined) yield* checkIssuer(seed, common.cloud)
      const connection = yield* selection.database ?? database
      const provider = yield* storage
      const backend = yield* cipher
      const file = Option.isSome(common.configFile)
        ? common.configFile.value
        : import.meta.bundled
          ? fileURLToPath(new URL("./bymorning.jsonc", import.meta.url))
          : fileURLToPath(new URL("../bymorning.jsonc", import.meta.url))
      // Installation documents reference non-secret settings by name; resolve
      // them from the same configuration source as every other setting.
      const text = yield* Configuration.read(file)
      const environment: Record<string, string | undefined> = {}
      for (const name of Configuration.references(text)) {
        environment[name] = Option.getOrUndefined(yield* Config.option(Config.string(name)))
      }
      const document = yield* Configuration.decode(text, file, environment)
      yield* checkInterpreter(document.info)
      // One startup notice for the endpoint designation caveat: Core reroutes
      // Bedrock Converse to bedrock-runtime-fips.<region>.amazonaws.com under
      // AWS_USE_FIPS_ENDPOINT, but Bedrock Mantle has no FIPS-designated endpoint
      // (bedrock-mantle-fips.* does not resolve) and keeps the standard hostname.
      if (fips === "true") {
        yield* Effect.logWarning(
          "AWS_USE_FIPS_ENDPOINT=true: Bedrock Converse model traffic uses bedrock-runtime-fips.<region>.amazonaws.com; " +
            "Bedrock Mantle has no FIPS-designated endpoint and continues to use bedrock-mantle.<region>.api.aws",
        )
      }
      // One line naming the live backends. The key identity is the configured
      // KMS ARN, the versioned Key Vault URL, or "local": a public identifier,
      // not a secret.
      yield* Effect.logInfo("Host resolved", {
        storage: provider.id,
        cipher: backend.keyID,
        cloud: Option.getOrElse(common.cloud, () => "-"),
        region: Option.getOrElse(common.region, () => "-"),
        fips,
      })
      const settings: Application.Settings = {
        appOrigin,
        host: common.host,
        port: common.port,
        // Local Login admits only the development identity's domain; each Auth
        // Provider admits its own domains.
        allowedEmailDomains: selection.local === undefined ? [] : [selection.local.email.split("@").at(-1)!],
        // Loopback origins keep development cookies; every other origin gets
        // the Secure `__Host-` cookie policy.
        cookiePolicy: loopback ? WebCookie.local : WebCookie.secure,
        cipher: backend,
        // The image root is read-only and not owned by the runtime user, and
        // the image ships no bun: cache Plugin materialization under the
        // writable temp directory and never install packages. Development keeps
        // its cache with the rest of its data.
        directory:
          development && Option.isSome(common.dataDirectory)
            ? common.dataDirectory.value
            : path.join(os.tmpdir(), "bymorning"),
        ...(development ? {} : { installPackage: false }),
        ...(selection.local === undefined ? {} : { local: selection.local }),
        ...(seed === undefined ? {} : { seed }),
        ...(Option.isSome(common.tls) ? { tls: common.tls.value } : {}),
        ...(Option.isSome(common.hardening.setupToken) ? { setupToken: common.hardening.setupToken.value } : {}),
        ...(Option.isSome(common.hardening.banner) ? { banner: common.hardening.banner.value } : {}),
        ...(Option.isSome(common.hardening.trustedProxies)
          ? {
              trustedProxies: common.hardening.trustedProxies.value
                .split(",")
                .map((value) => value.trim())
                .filter((value) => value !== ""),
            }
          : {}),
        configuration: [document],
      }
      return {
        settings,
        deps: {
          database: Postgres.node(connection),
          storage: Storage.configured({
            configure: (draft) => {
              draft.add(provider)
              draft.default.set(provider.id)
            },
          }),
          identity: selection.identity,
          cookie: WebCookie.makeNode(common.cookieKey),
        },
      }
    }),
  )

/** The failure's class and message collapsed onto one line; defects keep their pretty-printed cause. */
const summarize = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause)
  const tag =
    typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"
      ? error._tag
      : error instanceof Error
        ? error.name
        : "Unknown"
  const message = error instanceof Error ? error.message : String(error)
  return {
    tag,
    error: message.replace(/\s*\n\s*/g, " ").trim(),
    ...(Cause.hasFails(cause) ? {} : { cause: Cause.pretty(cause) }),
  }
}

/**
 * The pipeline both entries hand to `launch`: a fatal failure is logged once
 * through the configured logger as one line naming the error's tag and message
 * (a `Host.ConfigError` or Effect `ConfigError` names the setting), then the
 * failure propagates so the process exits non-zero. Interruption (SIGTERM) is
 * not an error.
 *
 * @param program - The selected entrypoint.
 * @param mode - The first process argument; `migrate` or the server.
 */
export const main = <A, E, R>(program: Effect.Effect<A, E, R>, mode: string | undefined) =>
  program.pipe(
    Effect.tapCause((cause) =>
      Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logError("Startup failed", summarize(cause)),
    ),
    Effect.annotateLogs({ role: mode === "migrate" ? "migrate" : "server" }),
  )

/**
 * Run one entry as the process: `main` under the launch telemetry, with the
 * runtime's own error report disabled so the failure is printed exactly once.
 */
export const launch = <E>(
  select: (mode: string | undefined) => Effect.Effect<unknown, E, never>,
  mode: string | undefined,
) =>
  NodeRuntime.runMain(main(select(mode), mode).pipe(Effect.provide(serverObservability)), {
    disableErrorReporting: true,
  })
