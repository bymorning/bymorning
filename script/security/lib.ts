/** Shared helpers for the release evidence scripts. */
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

export const fail = (message: string): never => {
  console.error(`error: ${message}`)
  process.exit(1)
}

export const run = (
  bin: string,
  argv: string[],
  options?: { cwd?: string; env?: Record<string, string>; quiet?: boolean },
) => {
  const result = spawnSync(bin, argv, {
    cwd: options?.cwd,
    encoding: "utf8",
    env: options?.env ? { ...process.env, ...options.env } : process.env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.error) fail(`${bin}: ${result.error.message}`)
  if (result.status !== 0) {
    if (!options?.quiet) console.error(result.stderr.trim() || result.stdout.trim())
    fail(`${bin} ${argv.join(" ")} failed (exit ${result.status})`)
  }
  return result.stdout
}

/** Run a tool that uses a non-zero exit to report findings; stdout is returned either way. */
export const runFindings = (bin: string, argv: string[], options?: { cwd?: string }) => {
  const result = spawnSync(bin, argv, { cwd: options?.cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  if (result.error) fail(`${bin}: ${result.error.message}`)
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr }
}

export const sha256File = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex")

export const git = (argv: string[], cwd: string) => run("git", argv, { cwd }).trim()

/** Which external binaries a script needs; returns the missing ones. */
export const missingTools = (names: ReadonlyArray<string>) =>
  names.filter((name) => spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).status !== 0)

export const BREW_INSTALL = "brew install syft grype cosign gitleaks semgrep trivy osv-scanner"

export const requireTools = (names: ReadonlyArray<string>, allowMissing: boolean) => {
  const missing = missingTools(names)
  if (missing.length === 0) return new Set<string>()
  console.error(`missing tools: ${missing.join(", ")}`)
  console.error(`install them with: ${BREW_INSTALL}`)
  if (!allowMissing) process.exit(1)
  return new Set(missing)
}

export const toolVersion = (name: string) => {
  for (const flag of ["version", "--version"]) {
    const result = spawnSync(name, [flag], { encoding: "utf8" })
    if (result.status === 0) {
      const match = /v?(\d+\.\d+\.\d+)/.exec(result.stdout + result.stderr)
      if (match) return match[1]
    }
  }
  return "unknown"
}

export const option = (args: string[], name: string, fallback?: string) => {
  const index = args.indexOf(`--${name}`)
  if (index === -1) return fallback
  return args[index + 1] ?? fail(`--${name} needs a value`)
}
