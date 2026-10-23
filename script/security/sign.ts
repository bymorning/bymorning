#!/usr/bin/env bun
/**
 * cosign sign-blob of the release tarball, SHA256SUMS, and, when the evidence
 * folder has them, the provenance statement and the OpenVEX statement (the
 * execution image's evidence has neither). BYMORNING_COSIGN_KEY names the key:
 * the release key in AWS KMS (awskms:///alias/bymorning-release, created by
 * script/release-key.sh; needs AWS credentials and AWS_REGION) or a local
 * private key path for development (COSIGN_PASSWORD unlocks it). The derived
 * public key is written to --out/cosign.pub so the customer can verify.
 * Never commit a private key.
 *
 *   bun script/security/sign.ts --tarball <oci.tar> --out <dir>
 *
 * Without BYMORNING_COSIGN_KEY the script prints development keypair
 * instructions and exits 0 without signing (evidence stays unsigned).
 *
 * main returns the signing provenance evidence.ts records in the manifest
 * (`Manifest.Signing`): `release` for the release key, `ephemeral` for any
 * other key, `unsigned` without one; signed results carry the fingerprint of
 * the cosign.pub written. The release key is BYMORNING_COSIGN_KEY starting
 * with awskms:///alias/bymorning-release, or equal to BYMORNING_RELEASE_KEY
 * when that is set. A PEM key file is ephemeral unless BYMORNING_SIGNING_KIND
 * is `release`, which only full-gate.yml's dispatch-with-the-real-key path
 * sets. Exports additionally require the fingerprint to match the delivered
 * cosign.pub, so a mislabeled ephemeral key still cannot ship.
 */
import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Manifest } from "../release/manifest.ts"
import { Signing } from "../release/signing.ts"
import { fail, option, run } from "./lib.ts"

export const DEV_KEYPAIR_HINT = [
  "signing skipped: BYMORNING_COSIGN_KEY is not set.",
  "generate a keypair with:  cosign generate-key-pair    # writes cosign.key (private) and cosign.pub",
  "then rerun with:          export BYMORNING_COSIGN_KEY=$PWD/cosign.key COSIGN_PASSWORD=<password>",
  "keep cosign.key out of the repository.",
].join("\n")

export const main = (args: string[]): Manifest.Signing => {
  const tarball = option(args, "tarball") ?? usage()
  const out = option(args, "out") ?? usage()
  const key = process.env.BYMORNING_COSIGN_KEY
  const kind = Signing.classify(process.env)
  if (key === undefined || kind === "unsigned") {
    console.log(DEV_KEYPAIR_HINT)
    return { kind: "unsigned" }
  }
  const kms = key.startsWith("awskms://")
  if (!kms && !existsSync(key)) fail(`BYMORNING_COSIGN_KEY points at ${key}, which does not exist`)
  const name = tarball.split("/").at(-1)!
  // cosign prompts for the key password on a TTY even when the key is
  // passphrase-less; an explicit empty COSIGN_PASSWORD keeps empty-passphrase
  // keys non-interactive. KMS signing reads the ambient AWS credentials.
  const env: Record<string, string> = kms ? {} : { COSIGN_PASSWORD: process.env.COSIGN_PASSWORD ?? "" }
  const pub = run("cosign", ["public-key", "--key", key], { quiet: true, env })
  const targets = [
    tarball,
    join(out, "SHA256SUMS"),
    join(out, "provenance.intoto.json"),
    join(out, "openvex.json"),
  ].filter((file) => existsSync(file))
  for (const file of targets) {
    const base = file === tarball ? join(out, name) : file
    // cosign v3 signs into a Sigstore bundle (signature + verification material).
    run("cosign", ["sign-blob", "--key", key, "--bundle", `${base}.bundle`, file], { env })
  }
  writeFileSync(join(out, "cosign.pub"), pub)
  const fingerprint = Manifest.fingerprint(pub)
  console.log(
    `sign: signed ${targets.map((file) => file.split("/").at(-1)).join(", ")}; public key at ${out}/cosign.pub`,
  )
  console.log(`sign: ${kind} key ${fingerprint}`)
  return { kind, key: fingerprint }
}

const usage = (): never => {
  console.error("usage: bun script/security/sign.ts --tarball <oci.tar> --out <dir>")
  process.exit(1)
}

if (import.meta.main) main(process.argv.slice(2))
