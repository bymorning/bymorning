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
const identity = "https://github.com/bymorning/bymorning/.github/workflows/full-gate.yml@refs/tags/v1.2.0"
const issuer = "https://token.actions.githubusercontent.com"
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
      signing: { kind: "keyless", identity, issuer },
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
    ["an unknown signing kind", (text: string) => text.replace('"kind": "keyless"', '"kind": "trusted"'), /kind/],
    [
      "a keyless artifact without its issuer",
      (text: string) => text.replace(`,\n        "issuer": "${issuer}"`, ""),
      /issuer/,
    ],
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

  test("round-trips an ephemeral key and describes each signing record", () => {
    const ephemeral = { kind: "ephemeral", key } as const
    const document = {
      ...manifest,
      artifacts: { ...manifest.artifacts, execution: { ...manifest.artifacts.execution, signing: ephemeral } },
    }
    expect(Manifest.parse(Manifest.print(document)).artifacts.execution.signing).toEqual(ephemeral)
    expect(Manifest.describe(manifest.artifacts.gateway.signing)).toBe(`keyless ${identity}`)
    expect(Manifest.describe(ephemeral)).toBe(`ephemeral key ${key}`)
    expect(Manifest.describe({ kind: "unsigned" })).toBe("unsigned")
  })

  test.each([
    ["a retired release-key record", { kind: "release", key }],
    ["a keyless record without an issuer", { kind: "keyless", identity }],
    ["a keyless record with an empty identity", { kind: "keyless", identity: "", issuer }],
    ["an ephemeral record without a key", { kind: "ephemeral" }],
    ["an ephemeral key that is not a fingerprint", { kind: "ephemeral", key: "c".repeat(64) }],
  ])("rejects %s", (_name, signing) => {
    const document = JSON.parse(Manifest.print(manifest))
    document.artifacts.gateway.signing = signing
    expect(() => Manifest.parse(JSON.stringify(document))).toThrow()
  })
})

describe("release signing", () => {
  test.each([
    ["no signing environment", {}, "unsigned"],
    ["an empty key", { BYMORNING_COSIGN_KEY: "" }, "unsigned"],
    ["a PEM key file", { BYMORNING_COSIGN_KEY: "/tmp/cosign.key" }, "key"],
    ["a KMS key", { BYMORNING_COSIGN_KEY: "awskms:///alias/anything" }, "key"],
    ["keyless", { BYMORNING_SIGN_KEYLESS: "1" }, "keyless"],
    ["keyless over a key", { BYMORNING_SIGN_KEYLESS: "1", BYMORNING_COSIGN_KEY: "/tmp/cosign.key" }, "keyless"],
    ["a keyless flag that is not 1", { BYMORNING_SIGN_KEYLESS: "true" }, "unsigned"],
  ])("selects the mode for %s", (_name, env, mode) => {
    expect(Signing.mode(env)).toBe(mode)
  })

  const workflow = "https://github.com/bymorning/bymorning/.github/workflows/full-gate.yml"
  test.each([
    ["full-gate on a version tag", `${workflow}@refs/tags/v1.3.1`, Signing.ISSUER, true],
    ["full-gate on a prerelease tag", `${workflow}@refs/tags/v1.4.0-rc.1`, Signing.ISSUER, true],
    ["full-gate on the dev branch", `${workflow}@refs/heads/dev`, Signing.ISSUER, false],
    ["full-gate on a branch named like a tag", `${workflow}@refs/heads/v1.3.1`, Signing.ISSUER, false],
    ["a non-version tag", `${workflow}@refs/tags/nightly`, Signing.ISSUER, false],
    ["another workflow", `${workflow.replace("full-gate", "ci")}@refs/tags/v1.3.1`, Signing.ISSUER, false],
    [
      "a fork",
      `${workflow.replace("bymorning/bymorning", "someone/bymorning")}@refs/tags/v1.3.1`,
      Signing.ISSUER,
      false,
    ],
    [
      "a lookalike repository",
      `${workflow.replace("bymorning/bymorning", "bymorning/bymorning-old")}@refs/tags/v1.3.1`,
      Signing.ISSUER,
      false,
    ],
    ["a different issuer", `${workflow}@refs/tags/v1.3.1`, "https://accounts.google.com", false],
    ["a tag followed by more path", `${workflow}@refs/tags/v1.3.1/../../heads/x`, Signing.ISSUER, false],
  ])("treats %s as a release signer: %s", (_name, who, from, expected) => {
    expect(Signing.isRelease(who, from)).toBe(expected)
  })

  test("the policy as a cosign regexp accepts what isRelease accepts", () => {
    const pattern = new RegExp(Signing.RELEASE_IDENTITY_PATTERN)
    expect(pattern.test(`${workflow}@refs/tags/v2.0.0`)).toBe(true)
    expect(pattern.test(`${workflow}@refs/heads/dev`)).toBe(false)
  })

  test("the workflow is the identity without its ref", () => {
    expect(Signing.workflow(`${workflow}@refs/tags/v1.3.1`)).toBe(workflow)
    expect(Signing.workflow(`${workflow}@refs/tags/v1.3.2`)).toBe(Signing.workflow(`${workflow}@refs/tags/v1.3.1`))
  })

  test("signer.txt round-trips and a damaged one names no signer", () => {
    const text = Signing.record(`${workflow}@refs/tags/v1.3.1`, Signing.ISSUER)
    expect(Signing.parse(text)).toEqual({ identity: `${workflow}@refs/tags/v1.3.1`, issuer: Signing.ISSUER })
    expect(Signing.parse("identity: only-this\n")).toBeUndefined()
    expect(Signing.parse(`identity: \nissuer: ${Signing.ISSUER}\n`)).toBeUndefined()
    expect(Signing.parse("")).toBeUndefined()
  })
})

describe("signing certificate", () => {
  const rawBytes =
    "MIICKjCCAdGgAwIBAgIUavrt2Rahpm62RcumkrOQ6ocfaYYwCgYIKoZIzj0EAwIwNzEVMBMGA1UECgwMc2lnc3RvcmUuZGV2MR4wHAYDVQQDDBVzaWdzdG9yZS1pbnRlcm1lZGlhdGUwIBcNMjYxMDI4MjE0MjQ5WhgPMjEyNjEwMDQyMTQyNDlaMDcxFTATBgNVBAoMDHNpZ3N0b3JlLmRldjEeMBwGA1UEAwwVc2lnc3RvcmUtaW50ZXJtZWRpYXRlMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEaHG82d0l/urPxg+55UCucjKvqBL6Dtro62W7NPdSaR+3OuLINfyWTHpbn/3hBjUfOKFI3FEj+HR+mKjn4DWfaKOBuDCBtTAdBgNVHQ4EFgQUo09qcTVW3JkGEbe6sChy22E5Ue8wHwYDVR0jBBgwFoAUo09qcTVW3JkGEbe6sChy22E5Ue8wDwYDVR0TAQH/BAUwAwEB/zBiBgNVHREEWzBZhldodHRwczovL2dpdGh1Yi5jb20vYnltb3JuaW5nL2J5bW9ybmluZy8uZ2l0aHViL3dvcmtmbG93cy9mdWxsLWdhdGUueW1sQHJlZnMvdGFncy92MS4yLjMwCgYIKoZIzj0EAwIDRwAwRAIgelB4Oc3Dako0BXsKLqcQnkthe4eKOvcFSzi+U1dBIP0CIBN+nXaMpYass+/B0aQg2o6InzZ9R27hPNGkUU9ifimb"
  const subject = "https://github.com/bymorning/bymorning/.github/workflows/full-gate.yml@refs/tags/v1.2.3"

  test("reads the signer identity from a single-certificate bundle", () => {
    const bundle = JSON.stringify({ verificationMaterial: { certificate: { rawBytes } } })
    expect(Signing.bundleIdentity(bundle)).toBe(subject)
  })

  test("reads it from a certificate-chain bundle", () => {
    const bundle = JSON.stringify({ verificationMaterial: { x509CertificateChain: { certificates: [{ rawBytes }] } } })
    expect(Signing.bundleIdentity(bundle)).toBe(subject)
  })

  test("a key signature has no certificate to read", () => {
    expect(() =>
      Signing.bundleIdentity(JSON.stringify({ verificationMaterial: { publicKey: { hint: "x" } } })),
    ).toThrow(/no signing certificate/)
  })
})

describe("release manifest records", () => {
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
