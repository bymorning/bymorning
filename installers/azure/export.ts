#!/usr/bin/env bun
/**
 * Assembles the customer package for the Azure installer from a release:
 *
 *   bymorning-azure-<version>/
 *     README.md                 installers/azure/README.md with the package preamble and this
 *                               release's version, commit, and sandbox path filled in
 *     RELEASE-NOTES.md          export/RELEASE-NOTES.md (or --notes <file>) with version and digests
 *     licenses.md               the Gateway image's third-party license report
 *     installers/azure/         modules/, environments/example/, k8s/, scripts/, smoke.sh
 *     sandbox/                  plugins/code-interpreter-kubernetes/deploy plus its customer README
 *     release/                  both tarballs, image-azure.txt and image-execution.txt (materialized
 *                               from manifest.json), cosign.pub, mirror.sh,
 *                               gateway/evidence/ and code-interpreter/evidence/ (the signed evidence
 *                               folders; SHA256SUMS names each tarball as ../../<tarball>), and
 *                               gateway/vulnerability-triage.md
 *   bymorning-azure-<version>.zip   the directory, zipped; its sha256 is printed
 *
 * Usage: bun installers/azure/export.ts --out <directory> [--release <directory>] [--notes <file>] [--force]
 *                                      [--allow-unsigned] [--rotate-key]
 *
 * --release is the release directory holding manifest.json, the tarballs, the
 * evidence folders, and cosign.pub (default: the repository's release/).
 * The export refuses evidence not signed with the release key: both artifacts'
 * `signing.kind` must be `release`, every cosign bundle must be present, and
 * cosign.pub must have the fingerprint the manifest records. --allow-unsigned
 * overrides that for a rehearsal and heads README.md "UNSIGNED REHEARSAL". An
 * existing package's release/cosign.pub is never replaced by a different key
 * without --rotate-key.
 *
 * The checkout must hold the release build: the manifest's revision is an
 * ancestor of HEAD and nothing changed since except release/, CHANGELOG.md,
 * docs/security/evidence/, and the version line of package.json and
 * app/host/package.json (script/release/delivery.ts). --force overrides that,
 * the uncommitted-changes check, and an existing package.
 * Everything that is not a tracked installer file stays out: .terraform/,
 * *.tfstate*, *.tfvars, generated overlays, and the installer's tests.
 */
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Delivery } from "../../script/release/delivery.ts"
import { Manifest } from "../../script/release/manifest.ts"

const installer = dirname(fileURLToPath(import.meta.url))
const repository = resolve(installer, "../..")
const args = process.argv.slice(2)
const option = (name: string) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? undefined : (args[index + 1] ?? fail(`--${name} needs a value`))
}
const out = resolve(option("out") ?? usage())
const release = resolve(option("release") ?? join(repository, "release"))
const notes = option("notes")
const force = args.includes("--force")

if (!existsSync(join(release, Manifest.FILE)))
  fail(`${join(release, Manifest.FILE)} is missing; run bun script/release.ts`)
const manifest = Manifest.read(release)
const { version, commit } = manifest
const name = `bymorning-azure-${version}`
// The checkout must hold the release build: the documented flow commits the
// manifest and evidence after building, so HEAD is the build plus release-only commits.
const drift = Delivery.lineage(repository, manifest.revision)
if (drift.length) {
  const list = drift.map((problem) => `  - ${problem}`).join("\n")
  if (!force)
    fail(
      `refusing to export: this checkout is not the release ${version} build\n${list}\npass --force to export anyway`,
    )
  console.warn(`exporting despite (--force)\n${list}`)
}
const dirty =
  git(["status", "--porcelain", "--", "installers/azure", "plugins/code-interpreter-kubernetes/deploy"]) !== ""
if (dirty && !force)
  fail("installers/azure or the sandbox manifests have uncommitted changes; commit them or pass --force")

for (const kind of ["gateway", "execution"] as const) {
  const artifact = manifest.artifacts[kind]
  if (!existsSync(join(release, artifact.tarball)))
    fail(`${join(release, artifact.tarball)} is missing; run bun script/release.ts`)
  if (!existsSync(join(release, artifact.evidence, "SHA256SUMS")))
    fail(`${join(release, artifact.evidence)} has no SHA256SUMS; run bun script/release.ts`)
}
// Only release-signed evidence is delivered; --allow-unsigned is for rehearsals.
const unsigned = Delivery.signing(release, manifest, ["gateway", "execution"])
const rehearsal = unsigned.length > 0
if (rehearsal) {
  const list = unsigned.map((problem) => `  - ${problem}`).join("\n")
  if (!args.includes("--allow-unsigned"))
    fail(
      `refusing to export: the release is not signed with the release key\n${list}\npass --allow-unsigned for a rehearsal`,
    )
  console.warn(`${Delivery.REHEARSAL}: exporting despite\n${list}`)
}
// The customer pins release/cosign.pub; replacing it with another key is a key rotation.
const rotation = Delivery.rotation(join(out, name, "release", "cosign.pub"), join(release, "cosign.pub"))
if (rotation) {
  const fingerprints = `  in ${join(out, name)}: ${rotation.before}\n  this release:  ${rotation.after}`
  if (!args.includes("--rotate-key"))
    fail(
      `refusing to replace ${join(out, name, "release", "cosign.pub")} with a different key\n${fingerprints}\npass --rotate-key to rotate it`,
    )
  console.warn(`rotating the release signing key\n${fingerprints}`)
}

const staged = mkdtempSync(join(tmpdir(), "bymorning-azure-export-"))
try {
  const pkg = join(staged, name)
  mkdirSync(pkg)

  // The installer: tracked files only. Tests, local state, provider caches,
  // generated overlays, and the export's own inputs never ship.
  cpSync(installer, join(pkg, "installers/azure"), {
    recursive: true,
    filter: (src) => {
      const rel = relative(installer, src)
      if (rel === "") return true
      const base = rel.split("/").at(-1)!
      if (
        [
          ".terraform",
          ".DS_Store",
          ".gitignore",
          "test",
          "tests",
          "test.sh",
          "export",
          "export.ts",
          "release",
        ].includes(base)
      )
        return false
      if (/\.tfstate|\.tfplan|\.tftest\.hcl$|\.tfmock\.hcl$|^crash\.log$|^outputs\.json$/.test(base)) return false
      if (base.endsWith(".tfvars")) return false // *.tfvars.example ships; filled-in values do not
      if (rel === "README.md") return false // generated below
      if (/^k8s\/overlays\/(?!example(\/|$))/.test(rel)) return false // only the tracked example overlay ships
      return true
    },
  })

  // The sandbox manifests, with their customer README.
  cpSync(join(repository, "plugins/code-interpreter-kubernetes/deploy"), join(pkg, "sandbox"), { recursive: true })
  cpSync(join(installer, "export/sandbox-README.md"), join(pkg, "sandbox/README.md"))

  // release/: tarballs, records, key, mirror.sh, evidence.
  const gateway = manifest.artifacts.gateway
  const execution = manifest.artifacts.execution
  const rel = join(pkg, "release")
  mkdirSync(join(rel, "gateway"), { recursive: true })
  mkdirSync(join(rel, "code-interpreter"), { recursive: true })
  cpSync(join(release, gateway.tarball), join(rel, gateway.tarball))
  cpSync(join(release, execution.tarball), join(rel, execution.tarball))
  // Only an unsigned rehearsal gets this far without a cosign.pub.
  if (existsSync(join(release, "cosign.pub"))) cpSync(join(release, "cosign.pub"), join(rel, "cosign.pub"))
  cpSync(join(installer, "release/mirror.sh"), join(rel, "mirror.sh"))
  cpSync(join(release, gateway.evidence), join(rel, "gateway/evidence"), { recursive: true })
  cpSync(join(release, execution.evidence), join(rel, "code-interpreter/evidence"), { recursive: true })
  const triage = join(repository, "docs/security/evidence/vulnerability-triage.md")
  if (!existsSync(triage)) fail(`${relative(repository, triage)} is missing`)
  cpSync(triage, join(rel, "gateway/vulnerability-triage.md"))
  writeFileSync(
    join(rel, "image-azure.txt"),
    Manifest.record(manifest, "gateway", [
      "ByMorning release image: the OCI tarball beside this file and its digest.",
      "Installers push the tarball into a registry and verify this digest.",
    ]),
  )
  writeFileSync(
    join(rel, "image-execution.txt"),
    Manifest.record(manifest, "execution", [
      "ByMorning Code Interpreter execution image (app/host/Dockerfile.execution): tarball and digest.",
      "Push the tarball to the registry the sandbox nodes pull from; reference it by digest in the",
      "Kubernetes Code Interpreter plugin options (image: <registry>/bymorning-code-interpreter@<digest>).",
    ]),
  )

  // Top-level documents.
  const licenses = join(release, gateway.evidence, "licenses.md")
  if (!existsSync(licenses)) fail(`${licenses} is missing; the Gateway evidence is incomplete`)
  cpSync(licenses, join(pkg, "licenses.md"))
  writeFileSync(
    join(pkg, "RELEASE-NOTES.md"),
    fill(readFileSync(notes ?? join(installer, "export/RELEASE-NOTES.md"), "utf8")),
  )
  writeFileSync(join(pkg, "README.md"), readme(readFileSync(join(installer, "README.md"), "utf8")))

  // Write the directory, then the zip beside it.
  if (existsSync(join(out, name)) || existsSync(join(out, `${name}.zip`))) {
    if (!force) fail(`${join(out, name)} or ${name}.zip exists; pass --force to replace them`)
    rmSync(join(out, name), { recursive: true, force: true })
    rmSync(join(out, `${name}.zip`), { force: true })
  }
  mkdirSync(out, { recursive: true })
  cpSync(pkg, join(out, name), { recursive: true })
  const zip = spawnSync("zip", ["-r", "-X", "-q", join(out, `${name}.zip`), name], { cwd: out, encoding: "utf8" })
  if (zip.status !== 0) fail(`zip failed: ${zip.stderr}`)
  const sha = spawnSync("shasum", ["-a", "256", `${name}.zip`], { cwd: out, encoding: "utf8" })
  if (sha.status !== 0) fail(`shasum failed: ${sha.stderr}`)
  console.log(`exported ${version} (${commit}) to ${join(out, name)}`)
  console.log(sha.stdout.trim())
} finally {
  rmSync(staged, { recursive: true, force: true })
}

/** Substitutes the release values in a template. */
function fill(text: string) {
  const values: Record<string, string> = {
    VERSION: version,
    COMMIT: commit,
    GATEWAY_DIGEST: manifest.artifacts.gateway.digest,
    EXECUTION_DIGEST: manifest.artifacts.execution.digest,
  }
  const filled = text.replaceAll(/\{\{([A-Z_]+)\}\}/g, (match, key: string) => values[key] ?? match)
  const left = [...filled.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((match) => match[1])
  if (left.length) fail(`unresolved placeholders: ${left.join(", ")}`)
  return filled
}

/**
 * The package README: the installer README with the package preamble in place
 * of its introduction line, the release's version and commit substituted for
 * the `<version>` and `<commit>` tokens, and the sandbox manifests at sandbox/.
 */
function readme(text: string) {
  const title = "# ByMorning on Azure (AKS)\n"
  if (!text.startsWith(title)) fail("installers/azure/README.md: unexpected title")
  const gateway = manifest.artifacts.gateway
  const execution = manifest.artifacts.execution
  const preamble = [
    `# ByMorning ${version} on Azure (AKS)`,
    "",
    ...(rehearsal
      ? [
          `> **${Delivery.REHEARSAL}: the release evidence is not signed with the ByMorning release key. Do not deploy.**`,
          "",
        ]
      : []),
    "## Contents of this package",
    "",
    ...table(
      ["Path", "Contents"],
      [
        ["`README.md`", "This installation guide"],
        ["`RELEASE-NOTES.md`", `What ${version} is, sign-in requirements, known limits`],
        ["`installers/azure/`", "Terraform module and example root, Kubernetes manifests, scripts, and `smoke.sh`"],
        ["`sandbox/`", "Code execution sandbox manifests and their [README](sandbox/README.md)"],
        ["`release/`", "Image tarballs, digests, signing key, `mirror.sh`, and signed evidence (SBOMs, scans, triage)"],
        ["`licenses.md`", "Third-party license report for the Gateway image"],
      ],
    ),
    "",
    ...table(
      ["Image", "Tarball", "Digest"],
      [
        ["Gateway", `\`release/${gateway.tarball}\``, `\`${gateway.digest}\``],
        ["Code execution", `\`release/${execution.tarball}\``, `\`${execution.digest}\``],
      ],
    ),
    "",
    `Both images were built from source commit \`${commit}\`. Evidence: \`release/gateway/evidence/\` (Gateway) and`,
    "`release/code-interpreter/evidence/` (code execution), signed with the key `release/cosign.pub`; see",
    "[Release evidence](#release-evidence). Compare `release/cosign.pub` with the key published at",
    "<https://github.com/bymorning/releases>.",
    "",
    "## Overview",
    "",
  ].join("\n")
  return (
    preamble +
    text
      .slice(title.length)
      .replaceAll("<version>", version)
      .replaceAll("<commit>", commit)
      .replaceAll("plugins/code-interpreter-kubernetes/deploy", "sandbox")
      .replaceAll("`plugins/code-interpreter-kubernetes/README.md`", "[sandbox/README.md](sandbox/README.md)")
  )
}

/** A Markdown table with padded columns. */
function table(header: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>) {
  const widths = header.map((cell, column) => Math.max(cell.length, ...rows.map((row) => row[column]!.length)))
  const line = (cells: ReadonlyArray<string>) =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column]!)).join(" | ")} |`
  return [line(header), `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`, ...rows.map(line)]
}

function git(argv: string[]) {
  const result = spawnSync("git", argv, { cwd: repository, encoding: "utf8" })
  if (result.status !== 0) fail(`git ${argv.join(" ")} failed: ${result.stderr}`)
  return result.stdout.trim()
}

function usage(): never {
  fail(
    "usage: bun installers/azure/export.ts --out <directory> [--release <directory>] [--notes <file>] [--force] [--allow-unsigned] [--rotate-key]",
  )
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
