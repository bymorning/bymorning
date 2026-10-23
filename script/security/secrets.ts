#!/usr/bin/env bun
/**
 * Secret scan of the repository (full git history) with gitleaks, using the
 * repository's .gitleaks.toml allowlist. Writes gitleaks.json into --out.
 * Fails when any finding survives the allowlist.
 *
 *   bun script/security/secrets.ts --root <repo> --out <dir>
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fail, option, runFindings, toolVersion } from "./lib.ts"

export const main = (args: string[]) => {
  const root = option(args, "root") ?? usage()
  const out = option(args, "out") ?? usage()
  const report = join(out, "gitleaks.json")
  const result = runFindings(
    "gitleaks",
    ["git", "--config", join(root, ".gitleaks.toml"), "--report-format", "json", "--report-path", report, "."],
    { cwd: root },
  )
  let findings = 0
  try {
    findings = (JSON.parse(readFileSync(report, "utf8")) as ReadonlyArray<unknown>).length
  } catch {
    findings = 0
  }
  if (result.status !== 0 || findings !== 0) {
    console.error(result.stderr.trim())
    fail(`gitleaks found ${findings} potential secret(s); see ${report}`)
  }
  console.log(`secrets: clean (gitleaks ${toolVersion("gitleaks")})`)
}

const usage = (): never => {
  console.error("usage: bun script/security/secrets.ts --root <repo> --out <dir>")
  process.exit(1)
}

if (import.meta.main) main(process.argv.slice(2))
