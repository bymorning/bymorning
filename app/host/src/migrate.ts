import { Effect, Schema } from "effect"
import { fileURLToPath } from "node:url"
import { run } from "../../../packages/server/src/migrator.js"

// The bundle embeds the migrations; source execution reads the checked-in folder.
const source = import.meta.bundled
  ? {}
  : { migrationsFolder: fileURLToPath(new URL("../../../packages/core/src/database/migration", import.meta.url)) }

/** Opaque migration failure; never carries a connection URL or SQL parameter. */
export class MigrationError extends Schema.TaggedError<MigrationError>()("Host.MigrationError", {}) {
  override get message() {
    return "Database migration failed"
  }
}

/** A PostgreSQL SQLSTATE (`28P01`) or Node error code (`ECONNREFUSED`, `SELF_SIGNED_CERT_IN_CHAIN`): letters, digits, underscores only. */
const codeShape = /^[A-Z0-9_]{2,64}$/

/** The first well-formed `code` in the cause chain; hosts, users, and passwords never have this shape. */
const code = (error: unknown, depth = 0): string | undefined => {
  if (typeof error !== "object" || error === null || depth > 8) return undefined
  const value = (error as { code?: unknown }).code
  if (typeof value === "string" && codeShape.test(value)) return value
  return code((error as { cause?: unknown }).cause, depth + 1)
}

/** The setting named by a Config failure, read from the schema issue's path. */
const setting = (issue: unknown, depth = 0): string | undefined => {
  if (typeof issue !== "object" || issue === null || depth > 8) return undefined
  const pointer = issue as { path?: unknown; issue?: unknown; cause?: unknown }
  if (Array.isArray(pointer.path))
    return pointer.path.filter((segment): segment is string => typeof segment === "string").join(".")
  return setting(pointer.issue ?? pointer.cause, depth + 1)
}

/**
 * What the log may say about a failed migration: the error's tag, the
 * provider's error code, and for a Config failure the setting it names. The
 * connection URL, host, user, password, and SQL never qualify.
 */
const classify = (error: unknown) => {
  const tag =
    typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"
      ? error._tag
      : "Unknown"
  const found = code(error)
  const named = tag === "ConfigError" ? setting(error) : undefined
  return {
    tag,
    ...(found === undefined ? {} : { code: found }),
    ...(named === undefined || named === "" ? {} : { setting: named }),
  }
}

/**
 * `node bymorning.mjs migrate` applies the packaged migrations and exits.
 * Deployments run it as a gate before the Gateway starts; the serving process
 * never migrates. It reads only DATABASE_URL and DATABASE_CA, selects no cloud
 * backend, and constructs no cloud client. The failure is opaque so a
 * connection URL or SQL parameter is never logged; the log names only the
 * error class (`classify`) so an operator can tell a refused connection from a
 * rejected password or certificate.
 *
 * @param input - Overrides for a host that already opened its database (development).
 */
export const migrate = (input: Parameters<typeof run>[0] = {}) =>
  Effect.suspend(() => run({ ...source, ...input })).pipe(
    Effect.tapError((error) => Effect.logError("Database migration failed", classify(error))),
    Effect.mapError(() => new MigrationError({})),
    Effect.andThen(Effect.log("Database migration complete")),
  )
