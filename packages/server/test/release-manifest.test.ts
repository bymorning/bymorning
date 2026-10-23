import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, test } from "vitest"
import { Manifest } from "../../../script/release/manifest.js"
import { Signing } from "../../../script/release/signing.js"

const scratch = mkdtempSync(join(tmpdir(), "release-manifest-test-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const commit = "0123456789ab"
const key = `sha256:${"c".repeat(64)}`
const manifest: Manifest.Manifest = {
  schema: 1,
  version: "1.2.0",
  commit,
  revision: `${commit}${"0".repeat(28)}`,
  created: "2026-09-30T00:00:00Z",
  artifacts: {
    gateway: {
      tarball: `bymorning-${commit}.tar`,
      digest: `sha256:${"a".repeat(64)}`,
      platform: "linux/amd64",
      dockerfile: "Dockerfile",
      evidence: "1.2.0/gateway",
      signing: { kind: "release", key },
    },
    execution: {
      tarball: `bymorning-code-interpreter-${commit}.tar`,
      digest: `sha256:${"b".repeat(64)}`,
      platform: "linux/amd64",
      dockerfile: "app/host/Dockerfile.execution",
      evidence: "1.2.0/execution",
      signing: { kind: "unsigned" },
    },
  },
}

describe("release manifest", () => {
  test("writes manifest.json and reads it back unchanged", () => {
    const path = Manifest.write(scratch, manifest)
    expect(path).toBe(join(scratch, "manifest.json"))
    expect(Manifest.read(scratch)).toEqual(manifest)
    // Stable, human-readable JSON: the file is committed and diffed per release.
    const text = readFileSync(path, "utf8")
    expect(text).toBe(JSON.stringify(manifest, null, 2) + "\n")
  })

  test.each([
    ["a tag instead of a digest", (text: string) => text.replace(`sha256:${"a".repeat(64)}`, "1.2.0"), /digest/],
    ["a short commit", (text: string) => text.replace(`"commit": "${commit}"`, '"commit": "0123"'), /commit/],
    [
      "another platform",
      (text: string) => text.replace('"platform": "linux/amd64"', '"platform": "linux/arm64"'),
      /platform/,
    ],
    ["an evidence folder outside the version", (text: string) => text.replace("1.2.0/gateway", "gateway"), /evidence/],
    [
      "a missing artifact",
      (text: string) => {
        const { execution: _, ...rest } = JSON.parse(text).artifacts
        return JSON.stringify({ ...JSON.parse(text), artifacts: rest })
      },
      /execution/,
    ],
    [
      "an unreleased version string",
      (text: string) => text.replace('"version": "1.2.0"', '"version": "v1.2.0"'),
      /version/,
    ],
    ["malformed JSON", (text: string) => text.slice(1), /./],
    ["an unknown schema", (text: string) => text.replace('"schema": 1', '"schema": 2'), /schema/],
    ["an unknown signing kind", (text: string) => text.replace('"kind": "release"', '"kind": "trusted"'), /kind/],
    ["a signed artifact without a key", (text: string) => text.replace(`,\n        "key": "${key}"`, ""), /key/],
    ["a key that is not a fingerprint", (text: string) => text.replace(key, "c".repeat(64)), /key/],
    [
      "a schema 1 manifest without signing",
      (text: string) => {
        const document = JSON.parse(text)
        delete document.artifacts.gateway.signing
        return JSON.stringify(document)
      },
      /signing/,
    ],
  ])("rejects %s", (_name, mutate, message) => {
    expect(() => Manifest.parse(mutate(Manifest.print(manifest)))).toThrow(message)
  })

  test("reads a manifest from before signing provenance as unsigned", () => {
    const document = JSON.parse(Manifest.print(manifest))
    delete document.schema
    delete document.artifacts.gateway.signing
    delete document.artifacts.execution.signing
    const legacy = Manifest.parse(JSON.stringify(document))
    expect(legacy.schema).toBe(1)
    expect(legacy.artifacts.gateway.signing).toEqual({ kind: "unsigned" })
    expect(legacy.artifacts.execution.signing).toEqual({ kind: "unsigned" })
    expect(legacy.artifacts.gateway.digest).toBe(manifest.artifacts.gateway.digest)
  })

  test("fingerprints a public key by its DER bytes", () => {
    const body = Buffer.from("not really a key but DER bytes").toString("base64")
    const pem = `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`
    const fingerprint = Manifest.fingerprint(pem)
    expect(fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
    // CRLF checkouts and missing trailing newlines do not change the fingerprint.
    expect(Manifest.fingerprint(pem.replaceAll("\n", "\r\n"))).toBe(fingerprint)
    expect(Manifest.fingerprint(pem.trimEnd())).toBe(fingerprint)
    expect(Manifest.fingerprint(pem.replace(body, Buffer.from("another key").toString("base64")))).not.toBe(fingerprint)
    expect(() => Manifest.fingerprint("ssh-ed25519 AAAA")).toThrow("PEM")
  })

  test.each([
    ["no key", {}, "unsigned"],
    ["an empty key", { BYMORNING_COSIGN_KEY: "" }, "unsigned"],
    ["the KMS release alias", { BYMORNING_COSIGN_KEY: "awskms:///alias/bymorning-release" }, "release"],
    ["another KMS key", { BYMORNING_COSIGN_KEY: "awskms:///alias/someone-else" }, "ephemeral"],
    [
      "another KMS key claiming release",
      { BYMORNING_COSIGN_KEY: "awskms:///alias/someone-else", BYMORNING_SIGNING_KIND: "release" },
      "ephemeral",
    ],
    ["a PEM key file", { BYMORNING_COSIGN_KEY: "/tmp/cosign.key" }, "ephemeral"],
    [
      "a PEM key file on the release path",
      { BYMORNING_COSIGN_KEY: "/tmp/cosign.key", BYMORNING_SIGNING_KIND: "release" },
      "release",
    ],
    [
      "a PEM key file with another signing kind",
      { BYMORNING_COSIGN_KEY: "/tmp/cosign.key", BYMORNING_SIGNING_KIND: "ephemeral" },
      "ephemeral",
    ],
    [
      "the explicitly named release key",
      { BYMORNING_COSIGN_KEY: "awskms:///arn:aws:kms:x", BYMORNING_RELEASE_KEY: "awskms:///arn:aws:kms:x" },
      "release",
    ],
    [
      "a key other than the named release key",
      { BYMORNING_COSIGN_KEY: "/tmp/cosign.key", BYMORNING_RELEASE_KEY: "awskms:///arn:aws:kms:x" },
      "ephemeral",
    ],
  ])("classifies %s", (_name, env, kind) => {
    expect(Signing.classify(env)).toBe(kind)
  })

  test("materializes the image*.txt record earlier releases shipped", () => {
    expect(Manifest.record(manifest, "gateway", ["first header", "second header"])).toBe(
      [
        "# first header",
        "# second header",
        `# built from bymorning/bymorning@${commit}`,
        "version: 1.2.0",
        `tarball: bymorning-${commit}.tar`,
        `digest: sha256:${"a".repeat(64)}`,
        "",
      ].join("\n"),
    )
    expect(Manifest.record(manifest, "execution", [])).toContain(`tarball: bymorning-code-interpreter-${commit}.tar`)
  })
})
