#!/usr/bin/env bun
/**
 * SBOM of the source dependencies from bun.lock (the shipped bundle is
 * minified, so the image SBOM cannot see them). Writes
 * sbom-source.cyclonedx.json (CycloneDX 1.6) into --out. The per-customer
 * environment roots and release/ are excluded with the same list as the source
 * scan; the shipped installer modules are included.
 *
 *   bun script/security/sbom-source.ts --root <repo> --version <semver> --out <dir>
 */
import { option, run } from "./lib.ts"
import { SOURCE_EXCLUDES } from "./scan.ts"

export const main = (args: string[]) => {
  const root = option(args, "root") ?? usage()
  const version = option(args, "version", "0.0.0")!
  const out = option(args, "out") ?? usage()
  run(
    "syft",
    [
      "dir:.",
      "--source-name",
      "bymorning-enterprise",
      "--source-version",
      version,
      ...SOURCE_EXCLUDES.flatMap((glob) => ["--exclude", glob]),
      "-o",
      `cyclonedx-json@1.6=${out}/sbom-source.cyclonedx.json`,
    ],
    { cwd: root },
  )
  console.log(`sbom-source: wrote ${out}/sbom-source.cyclonedx.json`)
}

const usage = (): never => {
  console.error("usage: bun script/security/sbom-source.ts --root <repo> --version <semver> --out <dir>")
  process.exit(1)
}

if (import.meta.main) main(process.argv.slice(2))
