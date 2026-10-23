#!/usr/bin/env bun
/**
 * `bun audit` advisory report over the frozen lockfile. Writes bun-audit.txt
 * into --out. Reported, not gating: grype (scan.ts) is the vulnerability gate;
 * this captures the npm-advisory view of the same dependency set, including
 * findings below the grype report's severity floor.
 *
 *   bun script/security/bun-audit.ts --root <repo> --out <dir>
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { option, runFindings } from "./lib.ts"

export const main = (args: string[]) => {
  const root = option(args, "root") ?? usage()
  const out = option(args, "out") ?? usage()
  // bun audit exits non-zero when advisories exist; the report is evidence, so
  // record the output either way and let triage (vulnerability-triage.md) rule.
  const result = runFindings("bun", ["audit"], { cwd: root })
  const body = (result.stdout + (result.stderr.trim() === "" ? "" : `\n${result.stderr}`)).trim()
  writeFileSync(join(out, "bun-audit.txt"), body + "\n")
  console.log(`bun-audit: wrote bun-audit.txt (exit ${result.status})`)
}

const usage = (): never => {
  console.error("usage: bun script/security/bun-audit.ts --root <repo> --out <dir>")
  process.exit(1)
}

if (import.meta.main) main(process.argv.slice(2))
