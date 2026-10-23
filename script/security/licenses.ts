#!/usr/bin/env bun
/**
 * License report derived from the CycloneDX SBOMs (image and source). Writes
 * licenses.md into --out: one section per artifact, license identifiers with
 * package counts, and the packages carrying no declared license.
 *
 *   bun script/security/licenses.ts --out <dir>
 *
 * Expects sbom-image.cyclonedx.json and sbom-source.cyclonedx.json in --out.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fail, option } from "./lib.ts"

interface Component {
  readonly name: string
  readonly version?: string
  readonly type?: string
  readonly licenses?: ReadonlyArray<{ license?: { id?: string; name?: string }; expression?: string }>
}

const licenseOf = (component: Component) => {
  const entries = (component.licenses ?? [])
    .map((entry) => entry.expression ?? entry.license?.id ?? entry.license?.name)
    .filter((value): value is string => value !== undefined)
  return entries.length === 0 ? ["NOASSERTION"] : [...new Set(entries)]
}

const section = (title: string, path: string) => {
  const sbom = JSON.parse(readFileSync(path, "utf8")) as { components?: ReadonlyArray<Component> }
  const components = (sbom.components ?? []).filter(
    (component) =>
      component.type === "library" ||
      component.type === "application" ||
      component.type === "framework" ||
      component.type === "operating-system",
  )
  const byLicense = new Map<string, number>()
  const unlicensed: string[] = []
  for (const component of components) {
    const names = licenseOf(component)
    if (names.includes("NOASSERTION"))
      unlicensed.push(component.version === undefined ? component.name : `${component.name}@${component.version}`)
    for (const name of names) byLicense.set(name, (byLicense.get(name) ?? 0) + 1)
  }
  const rows = [...byLicense.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return [
    `## ${title}`,
    "",
    `${components.length} components.`,
    "",
    "| License | Components |",
    "|---|---|",
    ...rows.map(([name, count]) => `| ${name} | ${count} |`),
    "",
    unlicensed.length === 0
      ? "Every component declares a license."
      : `Components without a declared license (${unlicensed.length}): ${unlicensed.slice(0, 40).join(", ")}${unlicensed.length > 40 ? ", …" : ""}`,
    "",
  ]
}

export const main = (args: string[]) => {
  const out = option(args, "out") ?? fail("usage: bun script/security/licenses.ts --out <dir>")
  writeFileSync(
    join(out, "licenses.md"),
    [
      "# License report",
      "",
      "Derived from the CycloneDX SBOMs in this folder; package metadata as published by upstream authors.",
      "",
      ...section("Image (bymorning-gateway)", join(out, "sbom-image.cyclonedx.json")),
      ...section("Source dependencies (bun.lock)", join(out, "sbom-source.cyclonedx.json")),
    ].join("\n"),
  )
  console.log(`licenses: wrote ${out}/licenses.md`)
}

if (import.meta.main) main(process.argv.slice(2))
