import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { documented, family, gaps, isPrerelease, parse, row, shipping } from "../../../script/security/prerelease.js"

const root = join(import.meta.dirname, "../../..")

// A tiny lockfile: `app` ships, `tool` is tooling, and one root dev dependency is pre-release.
const lock = parse(`{
  "workspaces": {
    "": { "devDependencies": { "dev-only": "1.0.0-rc.1" } },
    "apps/web": { "dependencies": { "runtime": "^2.0.0", "direct-beta": "0.0.0-beta-7" } },
    "packages/testing": { "dependencies": { "tool-only": "3.0.0-alpha.1" } },
  },
  "packages": {
    "runtime": ["runtime@2.0.0", "", { "dependencies": { "nested-rc": "^1.0.0-rc.2", "plain": "1.0.0" } }, "sha"],
    "nested-rc": ["nested-rc@1.0.0-rc.2", "", {}, "sha"],
    "plain": ["plain@1.0.0", "", {}, "sha"],
    "direct-beta": ["direct-beta@0.0.0-beta-7", "", {}, "sha"],
    "dev-only": ["dev-only@1.0.0-rc.1", "", {}, "sha"],
    "tool-only": ["tool-only@3.0.0-alpha.1", "", {}, "sha"],
  },
}`)

describe("pre-release dependencies that ship", () => {
  test("a pre-release tag is detected, build metadata and plain versions are not", () => {
    expect(isPrerelease("4.0.0-rc.112")).toBe(true)
    expect(isPrerelease("0.0.0-beta-19192")).toBe(true)
    expect(isPrerelease("1.0.0-rc.5-ab785fc")).toBe(true)
    expect(isPrerelease("1.2.3")).toBe(false)
    expect(isPrerelease("1.2.3+build.5")).toBe(false)
  })

  test("only packages reachable from a shipping workspace's dependencies count", () => {
    expect(shipping(lock).map((item) => `${item.name}@${item.version}`)).toEqual([
      "direct-beta@0.0.0-beta-7",
      "nested-rc@1.0.0-rc.2",
    ])
  })

  test("families group a scope or the first word of a name", () => {
    expect(family("@effect/sql-pg")).toBe("effect")
    expect(family("effect")).toBe("effect")
    expect(family("drizzle-orm")).toBe("drizzle")
    expect(family("@opencode-ai/ai")).toBe("opencode-ai")
  })

  test("a commit-hash suffix is not part of the documented version", () => {
    expect(documented("1.0.0-rc.5-ab785fc")).toBe("1.0.0-rc.5")
    expect(documented("0.0.0-beta-19192")).toBe("0.0.0-beta-19192")
    expect(documented("4.0.0-rc.112")).toBe("4.0.0-rc.112")
  })

  const packages = [
    { name: "effect", version: "4.0.0-rc.112" },
    { name: "@effect/sql-pg", version: "4.0.0-rc.112" },
    { name: "drizzle-orm", version: "1.0.0-rc.5-ab785fc" },
  ]
  const poam = (text: string) => `| POA&M-12 | something |\n| POA&M-13 | ${text} | 3.14.1 |\n`

  test("a POA&M-13 row that names every family and version passes", () => {
    expect(gaps(poam("Effect RC 4.0.0-rc.112 and Drizzle ORM 1.0.0-rc.5"), packages)).toEqual([])
  })

  test("a missing family, a stale version, and a missing row are each reported", () => {
    expect(gaps(poam("Effect RC 4.0.0-rc.112"), packages)).toEqual([
      "POA&M-13 does not name the drizzle family (drizzle-orm)",
      "POA&M-13 does not state version 1.0.0-rc.5",
    ])
    expect(gaps(poam("Effect RC 4.0.0-rc.99 and Drizzle ORM 1.0.0-rc.5"), packages)).toEqual([
      "POA&M-13 does not state version 4.0.0-rc.112",
    ])
    expect(gaps("| POA&M-12 | something |\n", packages)).toEqual(["docs/security/review/12-poam.md has no POA&M-13 row"])
    expect(row(poam("x"))).toContain("POA&M-13")
  })

  test("the repository's POA&M-13 covers every pre-release package its lockfile ships", () => {
    const found = shipping(parse(readFileSync(join(root, "bun.lock"), "utf8")))
    expect(found.length).toBeGreaterThan(0)
    expect(gaps(readFileSync(join(root, "docs/security/review/12-poam.md"), "utf8"), found)).toEqual([])
  })
})
