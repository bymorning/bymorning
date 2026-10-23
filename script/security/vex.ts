#!/usr/bin/env bun
/**
 * Ships the release's OpenVEX statement with the evidence. The authored,
 * reviewed source lives at docs/security/evidence/openvex.json (next
 * to vulnerability-triage.md, its human-readable counterpart); this step
 * validates the OpenVEX v0.2.0 shape, sets the document @id to this release's
 * installer-neutral identifier
 * (https://github.com/bymorning/bymorning/security/<version>/openvex), and
 * writes it to --out/openvex.json so the statement is covered by SHA256SUMS and
 * the cosign signature over it. Fails when the source is missing or malformed:
 * a release must not ship Critical/High findings without a recorded disposition.
 *
 *   bun script/security/vex.ts --root <repo> --version <semver> --out <dir>
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fail, option } from "./lib.ts"

const STATUSES = ["not_affected", "affected", "fixed", "under_investigation"] as const

/** The @id every shipped OpenVEX statement carries for a release. */
export const documentID = (version: string) => `https://github.com/bymorning/bymorning/security/${version}/openvex`

export const main = (args: string[]) => {
  const root = option(args, "root") ?? usage()
  const version = option(args, "version") ?? usage()
  const out = option(args, "out") ?? usage()
  const source = join(root, "docs/security/evidence/openvex.json")
  if (!existsSync(source))
    fail(`${source} is missing; author the OpenVEX statement next to vulnerability-triage.md before the release`)
  let document: {
    "@context"?: unknown
    "@id"?: unknown
    author?: unknown
    timestamp?: unknown
    statements?: Array<{ vulnerability?: unknown; status?: unknown; products?: unknown }>
  }
  try {
    document = JSON.parse(readFileSync(source, "utf8"))
  } catch (error) {
    fail(`${source} does not parse: ${error}`)
  }
  if (typeof document["@context"] !== "string" || !document["@context"].includes("openvex"))
    fail(`${source}: @context must be the OpenVEX context URI`)
  if (typeof document["@id"] !== "string" || typeof document.author !== "string")
    fail(`${source}: @id and author are required strings`)
  if (!Array.isArray(document.statements) || document.statements.length === 0)
    fail(`${source}: statements must be a non-empty array`)
  for (const [index, statement] of document.statements.entries()) {
    // OpenVEX v0.2.0 allows the vulnerability as an id string or an object with a name.
    const vulnerability =
      typeof statement.vulnerability === "string"
        ? statement.vulnerability
        : (statement.vulnerability as { name?: unknown } | undefined)?.name
    if (typeof vulnerability !== "string" || vulnerability === "")
      fail(`${source}: statement ${index} needs a vulnerability id`)
    if (!STATUSES.includes(statement.status as (typeof STATUSES)[number]))
      fail(`${source}: statement ${index} has unknown status ${String(statement.status)}`)
    if (!Array.isArray(statement.products) || statement.products.length === 0)
      fail(`${source}: statement ${index} needs at least one product`)
  }
  const id = documentID(version)
  if (document["@id"] !== id) console.log(`vex: @id ${String(document["@id"])} rewritten to ${id}`)
  writeFileSync(join(out, "openvex.json"), JSON.stringify({ ...document, "@id": id }, null, 2) + "\n")
  console.log(`vex: shipped openvex.json (${document.statements.length} statements, OpenVEX v0.2.0, ${id})`)
}

const usage = (): never => {
  console.error("usage: bun script/security/vex.ts --root <repo> --version <semver> --out <dir>")
  process.exit(1)
}

if (import.meta.main) main(process.argv.slice(2))
