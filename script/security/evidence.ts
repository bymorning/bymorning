#!/usr/bin/env bun
/**
 * Release evidence pipeline. Runs the evidence collectors against a built
 * release tarball and writes the folder the customer receives.
 *
 * --kind gateway (the Gateway image; the full set):
 *   sbom-image.cyclonedx.json / sbom-image.spdx.json   image contents (syft)
 *   sbom-source.cyclonedx.json                          bun.lock dependencies (syft)
 *   vulnerabilities-image/source-grype.json, vulnerabilities.md
 *   licenses.md
 *   gitleaks.json                                       secret scan (fails on findings)
 *   semgrep.sarif                                       static analysis
 *   bun-audit.txt                                       bun audit advisory report
 *   openvex.json                                        OpenVEX v0.2.0 dispositions (from docs/security/evidence)
 *   tools.txt                                           tool versions used
 *   provenance.intoto.json                              SLSA v1 statement
 *   SHA256SUMS                                          hashes of all of the above + the tarball
 *   <tarball>.bundle, SHA256SUMS.bundle, provenance...bundle, openvex.json.bundle, and the
 *   signer record: signer.txt + trusted_root.json (keyless) or cosign.pub (a key)
 *                                                       (when BYMORNING_SIGN_KEYLESS=1 or BYMORNING_COSIGN_KEY is set)
 *
 * --kind execution (the Code Interpreter execution image, app/host/Dockerfile.execution;
 * no first-party code, so only the image-level steps):
 *   sbom-image.cyclonedx.json / sbom-image.spdx.json, vulnerabilities-image-grype.json,
 *   vulnerabilities.md, tools.txt, SHA256SUMS, <tarball>.bundle, SHA256SUMS.bundle, signer record
 *
 *   bun script/security/evidence.ts --kind gateway|execution --tarball <oci.tar> --digest sha256:<image> \
 *     --version <semver> --commit <short12> --out <dir> [--manifest <release dir>] [--allow-missing]
 *
 * --manifest names the release directory whose manifest.json lists this
 * artifact (script/release.ts passes it); after signing, the artifact's
 * `signing` entry is set to who signed (keyless identity, ephemeral key
 * fingerprint) or `unsigned`. The artifact is matched by
 * --kind and must carry --digest.
 *
 * The evidence folder is release/<version>/<kind>/ and the tarball lives in
 * release/, so SHA256SUMS names it as ../../<tarball>; exports keep that depth.
 * --allow-missing skips steps whose tool is not installed (development only;
 * customer releases must run the full pipeline).
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Manifest } from "../release/manifest.ts"
import { fail, option, requireTools, sha256File, toolVersion } from "./lib.ts"
import { main as sbomImage } from "./sbom-image.ts"
import { main as sbomSource } from "./sbom-source.ts"
import { main as scan } from "./scan.ts"
import { main as licenses } from "./licenses.ts"
import { main as secrets } from "./secrets.ts"
import { main as semgrep } from "./semgrep.ts"
import { main as bunAudit } from "./bun-audit.ts"
import { main as provenance } from "./provenance.ts"
import { main as vex } from "./vex.ts"
import { main as sign } from "./sign.ts"

/** Files sign.ts writes beside the bundles; they describe the signature and are not content to checksum. */
const SIGNING_FILES = new Set(["cosign.pub", "signer.txt", "trusted_root.json", "SHA256SUMS"])

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const TOOLS = {
  gateway: ["syft", "grype", "cosign", "gitleaks", "semgrep"],
  execution: ["syft", "grype", "cosign"],
} as const
type Kind = keyof typeof TOOLS
type Tool = (typeof TOOLS)[Kind][number]

const parseKind = (value: string): Kind =>
  value === "gateway" || value === "execution" ? value : fail(`--kind must be gateway or execution, got ${value}`)

/** Image name recorded in the SBOMs and scan summaries. */
const SOURCE_NAME: Record<Kind, string> = { gateway: "bymorning-gateway", execution: "bymorning-code-interpreter" }

export const main = (argv: string[]) => {
  const allowMissing = argv.includes("--allow-missing")
  const kind = parseKind(option(argv, "kind", "gateway")!)
  const tarball = option(argv, "tarball") ?? usage()
  const digest = option(argv, "digest") ?? usage()
  const version = option(argv, "version") ?? usage()
  const commit = option(argv, "commit") ?? usage()
  const out = option(argv, "out") ?? usage()
  const manifestDir = option(argv, "manifest")
  if (option(argv, "profile") !== undefined) fail("--profile was removed: one image serves every deployment")
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) fail(`--digest must be the image digest (sha256:...), got ${digest}`)
  const missing = requireTools(TOOLS[kind], allowMissing)
  mkdirSync(out, { recursive: true })

  const step = (name: string, tool: Tool | null, fn: () => void) => {
    if (tool !== null && missing.has(tool)) {
      console.log(`${name}: skipped (${tool} not installed)`)
      return
    }
    console.log(`--- ${name}`)
    fn()
  }

  const name = SOURCE_NAME[kind]
  step("sbom-image", "syft", () => sbomImage(["--tarball", tarball, "--name", name, "--out", out]))
  if (kind === "gateway") {
    step("sbom-source", "syft", () => sbomSource(["--root", repository, "--version", version, "--out", out]))
    step("scan", "grype", () =>
      scan(["--tarball", tarball, "--name", name, "--root", repository, "--version", version, "--out", out]),
    )
    step("licenses", "syft", () => licenses(["--out", out]))
    step("secrets", "gitleaks", () => secrets(["--root", repository, "--out", out]))
    step("semgrep", "semgrep", () => semgrep(["--root", repository, "--out", out]))
    step("bun-audit", null, () => bunAudit(["--root", repository, "--out", out]))
    step("provenance", null, () =>
      provenance([
        "--tarball",
        tarball,
        "--digest",
        digest,
        "--root",
        repository,
        "--version",
        version,
        "--commit",
        commit,
        "--out",
        out,
      ]),
    )
    step("vex", null, () => vex(["--root", repository, "--version", version, "--out", out]))
  } else {
    step("scan", "grype", () => scan(["--tarball", tarball, "--name", name, "--version", version, "--out", out]))
  }

  writeFileSync(
    join(out, "tools.txt"),
    [
      "# tool versions that produced this evidence",
      ...TOOLS[kind].filter((tool) => !missing.has(tool)).map((tool) => `${tool}: ${toolVersion(tool)}`),
      `bun: ${Bun.version}`,
      "",
    ].join("\n"),
  )

  // SHA256SUMS covers the tarball (as ../../<name>: the evidence folder is
  // release/<version>/<kind>/ and the tarball is in release/, in the repository
  // and in every export) and every content artifact written so far. Signatures
  // are added afterwards and are verified with cosign, not listed here.
  const entries = readdirSync(out)
    .filter((file) => !file.endsWith(".sig") && !file.endsWith(".bundle") && !SIGNING_FILES.has(file))
    .toSorted()
  const lines = [`${sha256File(tarball)}  ../../${tarball.split("/").at(-1)!}`]
  for (const entry of entries) lines.push(`${sha256File(join(out, entry))}  ${entry}`)
  writeFileSync(join(out, "SHA256SUMS"), lines.join("\n") + "\n")
  console.log(`--- SHA256SUMS (${lines.length} entries)`)

  let signing: Manifest.Signing = { kind: "unsigned" }
  step("sign", "cosign", () => {
    signing = sign(["--tarball", tarball, "--out", out])
    if (signing.kind === "unsigned") console.log("sign: evidence is unsigned")
  })
  if (manifestDir !== undefined) record(manifestDir, kind, digest, signing)

  console.log(`evidence (${kind}): ${out}`)
}

/** Sets the artifact's signing provenance in <manifestDir>/manifest.json. */
const record = (manifestDir: string, kind: Kind, digest: string, signing: Manifest.Signing) => {
  const manifest = Manifest.read(manifestDir)
  const artifact = manifest.artifacts[kind]
  if (artifact.digest !== digest)
    fail(`${manifestDir}/${Manifest.FILE} lists ${kind} as ${artifact.digest}, not ${digest}`)
  Manifest.write(manifestDir, {
    ...manifest,
    artifacts: { ...manifest.artifacts, [kind]: { ...artifact, signing } },
  })
  console.log(`manifest: ${kind} signing ${Manifest.describe(signing)}`)
}

const usage = (): never => {
  console.error(
    "usage: bun script/security/evidence.ts --kind gateway|execution --tarball <oci.tar> --digest sha256:<image> --version <semver> --commit <short12> --out <dir> [--manifest <release dir>] [--allow-missing]",
  )
  process.exit(1)
}

if (import.meta.main) main(process.argv.slice(2))
