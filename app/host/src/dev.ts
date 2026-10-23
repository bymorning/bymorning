/**
 * Development entry: the same `Host.resolve` as the image, offering in
 * addition what never enters the image — PGlite when DATABASE_URL is absent,
 * filesystem storage, the local cipher backend, Local Login, and the Docker
 * Code Interpreter document. Environment
 * variables are the one surface; `defaults` fill in a loopback development
 * deployment under `.bymorning/local` so `bun run dev` needs nothing set.
 */
import type { Auth as CoreAuth } from "@bymorning/core/auth"
import { Cipher } from "@bymorning/core/cipher"
import { Storage } from "@bymorning/core/storage"
import { Auth } from "@bymorning/schema/auth"
import { NodeCrypto } from "@effect/platform-node"
import { Config, Effect, Option, Redacted, Schema, type Scope } from "effect"
import { randomBytes } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Application } from "../../../packages/server/src/application.js"
import { LocalWebProvider } from "../../../packages/server/src/application/adapters/identity-local.js"
import { kms, s3 } from "./aws.js"
import { blob, keyvault } from "./azure.js"
import { Host } from "./host.js"
import { migrate as runMigrate } from "./migrate.js"
import { open } from "./pglite.js"

export { MigrationError } from "./migrate.js"

// Both src/ and dist/ sit directly beneath app/host, which sits beneath app/.
const repository = fileURLToPath(new URL("../../../", import.meta.url))
const document = fileURLToPath(
  new URL(import.meta.bundled ? "./bymorning.docker.jsonc" : "../bymorning.docker.jsonc", import.meta.url),
)

/** The fixed development identity Local Login signs in on loopback origins. */
export const identity: CoreAuth.Local = {
  subject: Auth.Sub.make("developer"),
  email: Auth.Email.make("developer@local.test"),
}

const directory = Config.schema(Schema.NonEmptyString, "BYMORNING_DATA_DIR")

/** Validate one base64url-encoded 32-byte key from a file or a secret variable. */
const decodeKey = (key: string, setting: string) => {
  const trimmed = key.trim()
  return /^[A-Za-z0-9_-]+$/.test(trimmed) && Buffer.from(trimmed, "base64url").length === 32
    ? Effect.succeed(Redacted.make(trimmed))
    : Effect.fail(new Host.ConfigError({ setting, reason: "must contain 32 base64url-encoded bytes" }))
}

/** Read a persisted key, generating it owner-read-only on first use. */
const loadKey = (file: string, setting: string) =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, randomBytes(32).toString("base64url"), { flag: "wx", mode: 0o600 }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error
        },
      )
      return readFile(file, "utf8")
    },
    catch: (cause) => new Host.ConfigError({ setting, reason: `key file ${file} is unusable: ${String(cause)}` }),
  }).pipe(Effect.flatMap((key) => decodeKey(key, setting)))

/** Filesystem storage under `$BYMORNING_DATA_DIR/storage`. */
export const filesystem: Host.StorageFactory = Effect.map(directory, (data) =>
  Storage.filesystem({ directory: path.join(data, "storage") }),
)

/** Local cipher backend keyed by CIPHER_KEY or the generated `$BYMORNING_DATA_DIR/cipher.key`. */
export const local: Host.CipherFactory = Effect.gen(function* () {
  const supplied = yield* Config.option(Config.redacted("CIPHER_KEY"))
  const key = Option.isSome(supplied)
    ? yield* decodeKey(Redacted.value(supplied.value), "CIPHER_KEY")
    : yield* loadKey(path.join(yield* directory, "cipher.key"), "CIPHER_KEY")
  return yield* Cipher.localBackend(key).pipe(Effect.provide(NodeCrypto.layer))
})

/**
 * DATABASE_URL when set (with optional DATABASE_CA), otherwise a PGlite
 * database persisted under `<directory>/pglite` and served on a loopback
 * socket for the caller's scope.
 */
export const database = (data: string): Host.DatabaseFactory<Scope.Scope> =>
  Effect.gen(function* () {
    const url = yield* Config.option(Config.redacted("DATABASE_URL"))
    const ca = yield* Config.option(Config.redacted("DATABASE_CA"))
    if (Option.isSome(url)) return { url: url.value, ...(Option.isSome(ca) ? { ca: ca.value } : {}) }
    if (Option.isSome(ca))
      return yield* new Host.ConfigError({ setting: "DATABASE_CA", reason: "requires DATABASE_URL" })
    const opened = yield* open({ directory: path.join(data, "pglite") }).pipe(
      Effect.mapError((cause) => new Host.ConfigError({ setting: "BYMORNING_DATA_DIR", reason: cause.message })),
    )
    return { url: opened.url, ssl: false, maxConnections: 1 }
  })

/**
 * The development selection: the production table plus the development-only
 * implementations, and defaults for a loopback deployment. The cookie key is
 * generated beside the data on first use, so it is resolved here.
 */
export const selection: Effect.Effect<Host.Selection<Scope.Scope>, Host.ConfigError | Config.ConfigError> = Effect.gen(
  function* () {
    const data = yield* directory.pipe(Config.withDefault(path.join(repository, ".bymorning/local")))
    const port = yield* Config.port("PORT").pipe(Config.withDefault(3210))
    const cookieKey = yield* loadKey(path.join(data, "cookie.key"), "WEB_COOKIE_KEY")
    return {
      storage: { s3, "azure-blob": blob, filesystem },
      cipher: { kms, keyvault, local },
      database: database(data),
      // Local Login signs in on loopback origins only; the server refuses it
      // for any other origin, where sign-in runs through a registered Auth
      // Provider or the Setup flow.
      identity: LocalWebProvider.node(identity),
      local: identity,
      defaults: {
        STORAGE_PROVIDER: "filesystem",
        CIPHER_BACKEND: "local",
        HOST: "127.0.0.1",
        APP_ORIGIN: `http://localhost:${port}`,
        BYMORNING_DATA_DIR: data,
        BYMORNING_CONFIG: document,
        WEB_COOKIE_KEY: Redacted.value(cookieKey),
      },
    }
  },
)

const migration = (connection: Host.Database) =>
  runMigrate({
    url: connection.url,
    ...(connection.ssl === undefined ? {} : { ssl: connection.ssl }),
    ...(connection.ca === undefined ? {} : { ca: connection.ca }),
  })

/** Open the selected database and apply pending migrations. */
export const migrate = Effect.scoped(
  Effect.gen(function* () {
    const selected = yield* selection
    yield* migration(yield* selected.database!)
  }),
)

/** Open the database, migrate, then serve UI and API from one origin. */
export const program = Effect.scoped(
  Effect.gen(function* () {
    const selected = yield* selection
    const connection = yield* selected.database!
    const input = yield* Host.resolve({ ...selected, database: Effect.succeed(connection) })
    yield* migration(connection)
    return yield* Application.serve(Application.node(input), input.settings)
  }),
)

/** Selects the process entrypoint from the first argument after the bundle path. */
export const select = (mode: string | undefined) => (mode === "migrate" ? migrate : program)

if (process.argv[1] === fileURLToPath(import.meta.url)) Host.launch(select, process.argv[2])
