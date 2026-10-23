/**
 * Production entry of the ByMorning Gateway image: `node bymorning.mjs` serves,
 * `node bymorning.mjs migrate` applies the packaged migrations and exits. The
 * serve path loads the host composition (both cloud backends) on demand; the
 * migrate path reads only DATABASE_URL and DATABASE_CA and constructs no cloud
 * client.
 */
import { Effect } from "effect"
import { fileURLToPath } from "node:url"
import { Host } from "./host.js"
import { migrate as runMigrate } from "./migrate.js"

export { MigrationError } from "./migrate.js"

/** Apply the packaged migrations to DATABASE_URL; opaque on failure. */
export const migrate = runMigrate()

/** Resolve the deployment from the environment and serve the Gateway. */
export const program = Effect.flatMap(
  Effect.promise(() => import("./production.js")),
  (production) => production.program,
)

/** Selects the process entrypoint from the first argument after the bundle path. */
export const select = (mode: string | undefined) => (mode === "migrate" ? migrate : program)

if (process.argv[1] === fileURLToPath(import.meta.url)) Host.launch(select, process.argv[2])
