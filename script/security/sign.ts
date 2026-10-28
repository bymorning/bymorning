#!/usr/bin/env bun
/**
 * cosign sign-blob of the release tarball, SHA256SUMS, and, when the evidence
 * folder has them, the provenance statement and the OpenVEX statement (the
 * execution image's evidence has neither). Two ways to sign:
 *
 *   keyless (BYMORNING_SIGN_KEYLESS=1, in GitHub Actions with `id-token: write`)
 *     Sigstore keyless signing: no key exists. The certificate names the
 *     workflow run that signed and the signature is logged in Rekor. Each
 *     bundle is verified straight after signing, the signer identity is read
 *     from its certificate, and --out/signer.txt records `identity` and
 *     `issuer` (script/release/signing.ts) for the customer-side verifiers.
 *     --out/trusted_root.json is the Sigstore trust root cosign verified with,
 *     copied when cosign has cached one, so a host with no network can verify
 *     with `cosign verify-blob --trusted-root`.
 *
 *   key (BYMORNING_COSIGN_KEY: a PEM key path or a KMS reference)
 *     A throwaway or development key, recorded as `ephemeral`; COSIGN_PASSWORD
 *     unlocks a PEM key. The derived public key is written to --out/cosign.pub.
 *
 *   bun script/security/sign.ts --tarball <oci.tar> --out <dir>
 *
 * With neither, the script prints how to sign and exits 0 without signing
 * (evidence stays unsigned).
 *
 * main returns the signing record evidence.ts stores in the manifest
 * (`Manifest.Signing`). Whether a keyless signer is a release signer is the
 * installer export's decision (`Signing.isRelease`), not the build's.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Manifest } from "../release/manifest.ts"
import { Signing } from "../release/signing.ts"
import { fail, option, run } from "./lib.ts"

export const SIGN_HINT = [
  "signing skipped: neither BYMORNING_SIGN_KEYLESS=1 nor BYMORNING_COSIGN_KEY is set.",
  "release signing is keyless and runs in CI (full-gate.yml, dispatched with sign=true on a v* tag).",
  "for a local development signature:",
  "  cosign generate-key-pair    # writes cosign.key (private) and cosign.pub",
  "  export BYMORNING_COSIGN_KEY=$PWD/cosign.key COSIGN_PASSWORD=<password>",
  "keep cosign.key out of the repository.",
].join("\n")

/** The trust root cosign verified against, when its TUF cache holds one. */
const cachedTrustedRoot = () => {
  const roots = [process.env.TUF_ROOT, join(homedir(), ".sigstore", "root")].filter((dir): dir is string => !!dir)
  return roots.map((dir) => join(dir, "targets", "trusted_root.json")).find((file) => existsSync(file))
}

const targetsOf = (tarball: string, out: string) =>
  [tarball, join(out, "SHA256SUMS"), join(out, "provenance.intoto.json"), join(out, "openvex.json")]
    .filter((file) => existsSync(file))
    .map((file) => ({ file, bundle: `${file === tarball ? join(out, tarball.split("/").at(-1)!) : file}.bundle` }))

const signKeyless = (tarball: string, out: string): Manifest.Signing => {
  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL)
    fail("keyless signing needs a GitHub Actions OIDC token: run it in a workflow with `permissions: id-token: write`")
  const targets = targetsOf(tarball, out)
  for (const { file, bundle } of targets) run("cosign", ["sign-blob", "--yes", "--bundle", bundle, file])
  const identity = Signing.bundleIdentity(readFileSync(targets[0]!.bundle, "utf8"))
  const issuer = Signing.ISSUER
  // Prove each signature before recording it: the identity read from the certificate is what verifies.
  for (const { file, bundle } of targets)
    run(
      "cosign",
      [
        "verify-blob",
        "--bundle",
        bundle,
        "--certificate-identity",
        identity,
        "--certificate-oidc-issuer",
        issuer,
        file,
      ],
      { quiet: true },
    )
  writeFileSync(join(out, "signer.txt"), Signing.record(identity, issuer))
  const root = cachedTrustedRoot()
  if (root !== undefined) copyFileSync(root, join(out, "trusted_root.json"))
  else console.log("sign: no cached Sigstore trust root found; offline verification needs one supplied separately")
  console.log(`sign: signed ${targets.map(({ file }) => file.split("/").at(-1)).join(", ")}`)
  console.log(`sign: keyless ${identity} (${issuer})${Signing.isRelease(identity, issuer) ? " [release signer]" : ""}`)
  return { kind: "keyless", identity, issuer }
}

const signWithKey = (key: string, tarball: string, out: string): Manifest.Signing => {
  const kms = key.includes("://")
  if (!kms && !existsSync(key)) fail(`BYMORNING_COSIGN_KEY points at ${key}, which does not exist`)
  // cosign prompts for the key password on a TTY even when the key is
  // passphrase-less; an explicit empty COSIGN_PASSWORD keeps empty-passphrase
  // keys non-interactive. A KMS key reads the ambient cloud credentials.
  const env: Record<string, string> = kms ? {} : { COSIGN_PASSWORD: process.env.COSIGN_PASSWORD ?? "" }
  const pub = run("cosign", ["public-key", "--key", key], { quiet: true, env })
  const targets = targetsOf(tarball, out)
  // cosign v3 signs into a Sigstore bundle (signature + verification material).
  for (const { file, bundle } of targets) run("cosign", ["sign-blob", "--key", key, "--bundle", bundle, file], { env })
  writeFileSync(join(out, "cosign.pub"), pub)
  const fingerprint = Manifest.fingerprint(pub)
  console.log(
    `sign: signed ${targets.map(({ file }) => file.split("/").at(-1)).join(", ")}; public key at ${out}/cosign.pub`,
  )
  console.log(`sign: ephemeral key ${fingerprint}`)
  return { kind: "ephemeral", key: fingerprint }
}

export const main = (args: string[]): Manifest.Signing => {
  const tarball = option(args, "tarball") ?? usage()
  const out = option(args, "out") ?? usage()
  const mode = Signing.mode(process.env)
  if (mode === "unsigned") {
    console.log(SIGN_HINT)
    return { kind: "unsigned" }
  }
  return mode === "keyless" ? signKeyless(tarball, out) : signWithKey(process.env.BYMORNING_COSIGN_KEY!, tarball, out)
}

const usage = (): never => {
  console.error("usage: bun script/security/sign.ts --tarball <oci.tar> --out <dir>")
  process.exit(1)
}

if (import.meta.main) main(process.argv.slice(2))
