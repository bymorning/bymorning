/**
 * Dependency boundary check: @bymorning/core must stay free of cloud SDKs.
 * Cloud backends live in backends/* (backends/aws, backends/azure); the one
 * Gateway image bundles both, and app/host selects one of each at startup
 * (STORAGE_PROVIDER, CIPHER_BACKEND). Core never reaches a cloud SDK directly.
 * The import side of this rule is the ast-grep no-core-cloud-sdk rule; this
 * script covers the declared dependency side.
 *
 * Runs as part of `bun run lint`.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const forbidden = [/^@aws-sdk\//, /^@smithy\//, /^@azure\//, /^@google-cloud\//]
const sections = ["dependencies", "devDependencies", "peerDependencies"] as const

const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../packages/core/package.json"), "utf8")) as Record<
  (typeof sections)[number],
  Record<string, string> | undefined
>

const violations: string[] = []
for (const section of sections) {
  for (const name of Object.keys(manifest[section] ?? {})) {
    if (forbidden.some((pattern) => pattern.test(name))) violations.push(`${section}: ${name}`)
  }
}

if (violations.length > 0) {
  console.error("@bymorning/core must not depend on cloud SDKs:")
  for (const violation of violations) console.error(`  ${violation}`)
  process.exit(1)
}
console.log("@bymorning/core declares no cloud SDK dependencies")
