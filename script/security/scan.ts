#!/usr/bin/env bun
/**
 * Vulnerability scan of a release image tarball and, when --root is given, the
 * source dependencies, with grype. Writes vulnerabilities-image-grype.json,
 * vulnerabilities-source-grype.json (with --root), and a human summary
 * vulnerabilities.md.
 *
 *   bun script/security/scan.ts --tarball <oci.tar> [--root <repo>] --version <semver> --out <dir> \
 *     [--name <image name>]
 *
 * Without --root (the execution image, which carries no first-party code) only
 * the image is scanned. --name labels the image in the summary (default
 * bymorning-gateway). The source scan excludes the per-deployment environment
 * roots (installers/azure/environments) and release/; the installer modules that
 * ship to customers (installers/azure/modules) are scanned.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { option, run, toolVersion } from "./lib.ts"

interface GrypeMatch {
  readonly vulnerability: {
    readonly id: string
    readonly severity: string
    readonly description?: string
    readonly urls?: ReadonlyArray<string>
    readonly fix?: { readonly versions?: ReadonlyArray<string>; readonly state?: string }
  }
  readonly artifact: { readonly name: string; readonly version?: string; readonly type?: string }
}

const severities = ["Critical", "High", "Medium", "Low", "Negligible", "Unknown"] as const

const counts = (matches: ReadonlyArray<GrypeMatch>) => {
  const tally = new Map<string, number>()
  for (const match of matches)
    tally.set(match.vulnerability.severity, (tally.get(match.vulnerability.severity) ?? 0) + 1)
  return severities.map((severity) => [severity, tally.get(severity) ?? 0] as const).filter(([, count]) => count > 0)
}

const rank = (severity: string) => severities.indexOf(severity as (typeof severities)[number])

const table = (matches: ReadonlyArray<GrypeMatch>, cap: number) => {
  const rows = matches
    .slice()
    .sort(
      (a, b) =>
        rank(a.vulnerability.severity) - rank(b.vulnerability.severity) ||
        a.vulnerability.id.localeCompare(b.vulnerability.id),
    )
    .slice(0, cap)
    .map((match) => {
      const fix = match.vulnerability.fix?.versions?.join(", ")
      return `| ${match.vulnerability.severity} | ${match.vulnerability.id} | ${match.artifact.name} | ${match.artifact.version ?? ""} | ${fix === undefined || fix === "" ? "—" : fix} |`
    })
  return ["| Severity | Advisory | Package | Installed | Fixed in |", "|---|---|---|---|---|", ...rows].join("\n")
}

/** Paths the source scan skips: build output, caches, and trees that are not the shipped image. */
export const SOURCE_EXCLUDES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.git/**",
  // git-ignored local Terraform provider caches hold third-party Go binaries
  // that are never committed or shipped.
  "**/.terraform/**",
  // Per-deployment environment roots and the committed release evidence. The
  // shipped installer modules (installers/azure/modules/**) stay in scope;
  // syft and grype (1.52) apply ./-anchored globs relative to the scan root.
  "./installers/azure/environments/**",
  "./release/**",
] as const

const summary = (matches: ReadonlyArray<GrypeMatch>) =>
  counts(matches)
    .map(([s, c]) => `${s}: ${c}`)
    .join(", ") || "none"

export const main = (args: string[]) => {
  const tarball = option(args, "tarball") ?? usage()
  const root = option(args, "root")
  const version = option(args, "version", "0.0.0")!
  const out = option(args, "out") ?? usage()
  const name = option(args, "name", "bymorning-gateway")!
  run("grype", [`oci-archive:${tarball}`, "-o", `json=${join(out, "vulnerabilities-image-grype.json")}`], {
    quiet: true,
  })
  const image = JSON.parse(readFileSync(join(out, "vulnerabilities-image-grype.json"), "utf8")) as {
    matches: ReadonlyArray<GrypeMatch>
    descriptor?: { timestamp?: string }
  }
  const imageCounts = summary(image.matches)
  const report = [
    `# Vulnerability scan — ByMorning ${version}`,
    "",
    `Scanner: grype ${toolVersion("grype")} (${image.descriptor?.timestamp ?? "unknown time"})`,
    "",
    `## Image (${name} OCI tarball)`,
    "",
    `${image.matches.length} findings — ${imageCounts}.`,
    "",
    table(image.matches, 50),
    "",
  ]
  if (root === undefined) {
    report.push("Full data: vulnerabilities-image-grype.json.", "")
    writeFileSync(join(out, "vulnerabilities.md"), report.join("\n"))
    console.log(`scan: image ${imageCounts}`)
    return
  }
  run(
    "grype",
    [
      "dir:.",
      ...SOURCE_EXCLUDES.flatMap((glob) => ["--exclude", glob]),
      "-o",
      `json=${join(out, "vulnerabilities-source-grype.json")}`,
    ],
    { cwd: root, quiet: true },
  )
  const source = JSON.parse(readFileSync(join(out, "vulnerabilities-source-grype.json"), "utf8")) as {
    matches: ReadonlyArray<GrypeMatch>
  }
  const sourceCounts = summary(source.matches)
  report.push(
    `## Source dependencies (bun.lock)`,
    "",
    `${source.matches.length} findings — ${sourceCounts}.`,
    "",
    table(source.matches, 50),
    "",
    "Full data: vulnerabilities-image-grype.json, vulnerabilities-source-grype.json.",
    "",
  )
  writeFileSync(join(out, "vulnerabilities.md"), report.join("\n"))
  console.log(`scan: image ${imageCounts}; source ${sourceCounts}`)
}

const usage = (): never => {
  console.error(
    "usage: bun script/security/scan.ts --tarball <oci.tar> [--root <repo>] --version <semver> --out <dir> [--name <image name>]",
  )
  process.exit(1)
}

if (import.meta.main) main(process.argv.slice(2))
