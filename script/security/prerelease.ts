#!/usr/bin/env bun
/**
 * Pre-release dependencies that ship, checked against the security review.
 *
 * POA&M-13 (docs/security/review/12-poam.md) must name every pre-release
 * package the Gateway or its web UI depends on, with its version. The list is
 * derived from bun.lock: a package counts when a semver pre-release tag is in
 * its locked version and it is reachable from the `dependencies` of a workspace
 * that ships. Tooling workspaces and every devDependency are excluded. The
 * check fails when a shipping pre-release package or version is missing from
 * the POA&M-13 row, so the document cannot drift from the lockfile again.
 *
 *   bun script/security/prerelease.ts            # check (exit 1 on a gap)
 *   bun script/security/prerelease.ts --list     # print the shipping pre-release packages
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

/** Workspaces that are build or test tooling, never shipped. Every other workspace is assumed to ship. */
export const TOOLING = new Set([".", "", "packages/docs", "packages/scripts", "packages/testing", "packages/httpapi-codegen", "plugins/example"])

export interface Locked {
  readonly name: string
  readonly version: string
}

interface Lockfile {
  readonly workspaces: Record<string, { readonly dependencies?: Record<string, string> }>
  readonly packages: Record<string, readonly [string, string, { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }?, ...unknown[]]>
}

/** bun.lock is JSONC with trailing commas. */
export const parse = (text: string): Lockfile => JSON.parse(text.replace(/,(\s*[}\]])/g, "$1")) as Lockfile

const split = (identifier: string): Locked => {
  const at = identifier.lastIndexOf("@")
  return { name: identifier.slice(0, at), version: identifier.slice(at + 1) }
}

/** A semver pre-release tag, such as 4.0.0-rc.112 or 0.0.0-beta-19192. Build metadata (+...) is not one. */
export const isPrerelease = (version: string) => /^\d+\.\d+\.\d+-[0-9A-Za-z]/.test(version)

/** Pre-release packages reachable from the production dependencies of the workspaces that ship. */
export const shipping = (lock: Lockfile): ReadonlyArray<Locked> => {
  const edges = (key: string) => {
    const meta = lock.packages[key]?.[2]
    return { ...meta?.dependencies, ...meta?.optionalDependencies }
  }
  // A nested copy ("parent/name") shadows the hoisted one for that parent.
  const resolve = (parent: string | undefined, name: string) =>
    parent !== undefined && `${parent}/${name}` in lock.packages ? `${parent}/${name}` : name in lock.packages ? name : undefined
  const seen = new Set<string>()
  const stack: Array<string> = []
  for (const [workspace, info] of Object.entries(lock.workspaces)) {
    if (TOOLING.has(workspace)) continue
    for (const name of Object.keys(info.dependencies ?? {})) {
      const key = resolve(undefined, name)
      if (key !== undefined) stack.push(key)
    }
  }
  while (stack.length > 0) {
    const key = stack.pop()!
    if (seen.has(key)) continue
    seen.add(key)
    for (const name of Object.keys(edges(key))) {
      const next = resolve(key, name)
      if (next !== undefined && !seen.has(next)) stack.push(next)
    }
  }
  const found = new Map<string, Locked>()
  for (const key of seen) {
    const locked = split(lock.packages[key]![0])
    if (isPrerelease(locked.version)) found.set(`${locked.name}@${locked.version}`, locked)
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** The family a package belongs to: its scope, or the first word of its name (`effect`, `drizzle`, `opencode-ai`). */
export const family = (name: string) => (name.startsWith("@") ? name.slice(1).split("/")[0]! : name.split("-")[0]!)

/** A trailing commit-hash suffix (1.0.0-rc.5-ab785fc) is build identity, not part of the version the document names. */
export const documented = (version: string) => version.replace(/-[0-9a-f]{7,}$/, "")

/** The POA&M-13 table row, or undefined when it is missing. */
export const row = (poam: string) => poam.split("\n").find((line) => line.startsWith("| POA&M-13 |"))

/** What the POA&M-13 row fails to name. Empty when it covers every shipping pre-release package. */
export const gaps = (poam: string, packages: ReadonlyArray<Locked>): ReadonlyArray<string> => {
  const text = row(poam)
  if (text === undefined) return ["docs/security/review/12-poam.md has no POA&M-13 row"]
  const lower = text.toLowerCase()
  const problems: Array<string> = []
  for (const group of Map.groupBy(packages, (item) => family(item.name)).entries()) {
    const [name, members] = group
    if (!lower.includes(name.toLowerCase()))
      problems.push(`POA&M-13 does not name the ${name} family (${members.map((item) => item.name).join(", ")})`)
  }
  for (const version of new Set(packages.map((item) => documented(item.version))))
    if (!text.includes(version)) problems.push(`POA&M-13 does not state version ${version}`)
  return problems
}

export const main = (args: string[]) => {
  const root = join(import.meta.dirname, "../..")
  const packages = shipping(parse(readFileSync(join(root, "bun.lock"), "utf8")))
  if (args.includes("--list")) {
    for (const item of packages) console.log(`${item.name}@${item.version}`)
    return
  }
  const problems = gaps(readFileSync(join(root, "docs/security/review/12-poam.md"), "utf8"), packages)
  if (problems.length > 0) {
    console.error("The security review's POA&M-13 is out of date with bun.lock:")
    for (const problem of problems) console.error(`  ${problem}`)
    console.error(`Shipping pre-release packages: ${packages.map((item) => `${item.name}@${item.version}`).join(", ")}`)
    process.exit(1)
  }
  console.log(`prerelease: POA&M-13 names all ${packages.length} shipping pre-release packages`)
}

if (import.meta.main) main(process.argv.slice(2))
