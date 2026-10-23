#!/usr/bin/env bun
/**
 * Static analysis of first-party TypeScript with semgrep registry rulesets
 * p/default, p/typescript, and p/owasp-top-ten. Writes semgrep.sarif into
 * --out and prints a findings summary. Findings are evidence, not a gate: the
 * report ships with the release. The per-deployment environment roots
 * (installers/azure/environments) are not scanned; the shipped installer
 * module (installers/azure/modules) is. release/ is outside the scanned directories.
 *
 *   bun script/security/semgrep.ts --root <repo> --out <dir>
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { option, run, toolVersion } from "./lib.ts"

export const main = (args: string[]) => {
  const root = option(args, "root") ?? usage()
  const out = option(args, "out") ?? usage()
  const paths = ["app", "packages", "plugins", "backends", "installers", "script"].filter((dir) =>
    existsSync(join(root, dir)),
  )
  run(
    "semgrep",
    [
      "scan",
      "--config",
      "p/default",
      "--config",
      "p/typescript",
      "--config",
      "p/owasp-top-ten",
      "--sarif",
      "--output",
      join(out, "semgrep.sarif"),
      "--exclude",
      "node_modules",
      "--exclude",
      "dist",
      "--exclude",
      "generated",
      // The per-deployment environment roots only; installers/azure/modules ships
      // to customers and is scanned. Measured with semgrep 1.176.0: a pattern
      // with a slash (installers/azure/environments) only applies inside a git
      // checkout, and a leading **/installers/ never matches outside one (paths
      // are taken relative to the scan target). The **/<parent>/environments/**
      // form excludes the same files either way.
      "--exclude",
      "**/azure/environments/**",
      "--metrics",
      "off",
      ...paths,
    ],
    { cwd: root },
  )
  const sarif = JSON.parse(readFileSync(join(out, "semgrep.sarif"), "utf8")) as {
    runs: ReadonlyArray<{ results?: ReadonlyArray<{ level?: string }> }>
  }
  const results = sarif.runs.flatMap((run) => run.results ?? [])
  const errors = results.filter((result) => result.level === "error").length
  console.log(
    `semgrep: ${results.length} findings (${errors} errors), sarif written (semgrep ${toolVersion("semgrep")})`,
  )
  if (errors > 0) console.error(`note: ${errors} error-level semgrep findings; review semgrep.sarif`)
}

const usage = (): never => {
  console.error("usage: bun script/security/semgrep.ts --root <repo> --out <dir>")
  process.exit(1)
}

if (import.meta.main) main(process.argv.slice(2))
