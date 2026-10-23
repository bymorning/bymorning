import { spawnSync } from "node:child_process"
import { generateKeyPairSync } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, test } from "vitest"
import { Delivery } from "../../../script/release/delivery.js"
import { Manifest } from "../../../script/release/manifest.js"

const scratch = mkdtempSync(join(tmpdir(), "release-delivery-test-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const pem = () =>
  generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ type: "spki", format: "pem" }).toString()
const releaseKey = pem()
const otherKey = pem()
const commit = "0123456789ab"

const manifest = (signing: Manifest.Signing, execution: Manifest.Signing = signing): Manifest.Manifest => ({
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
      signing,
    },
    execution: {
      tarball: `bymorning-code-interpreter-${commit}.tar`,
      digest: `sha256:${"b".repeat(64)}`,
      platform: "linux/amd64",
      dockerfile: "app/host/Dockerfile.execution",
      evidence: "1.2.0/execution",
      signing: execution,
    },
  },
})

let counter = 0
/** A release directory laid out as script/release.ts writes it, signed by `key`. */
const release = (key: string | undefined, options: { drop?: string; evidenceKey?: string } = {}) => {
  const dir = join(scratch, `release-${counter++}`)
  const files: Record<string, string> = {
    [`1.2.0/gateway/bymorning-${commit}.tar.bundle`]: "{}",
    "1.2.0/gateway/SHA256SUMS": "",
    "1.2.0/gateway/SHA256SUMS.bundle": "{}",
    "1.2.0/gateway/provenance.intoto.json": "{}",
    "1.2.0/gateway/provenance.intoto.json.bundle": "{}",
    "1.2.0/gateway/openvex.json": "{}",
    "1.2.0/gateway/openvex.json.bundle": "{}",
    [`1.2.0/execution/bymorning-code-interpreter-${commit}.tar.bundle`]: "{}",
    "1.2.0/execution/SHA256SUMS": "",
    "1.2.0/execution/SHA256SUMS.bundle": "{}",
  }
  if (key !== undefined) {
    files["cosign.pub"] = key
    files["1.2.0/gateway/cosign.pub"] = options.evidenceKey ?? key
    files["1.2.0/execution/cosign.pub"] = key
  }
  for (const [path, content] of Object.entries(files)) {
    if (path === options.drop) continue
    mkdirSync(join(dir, path, ".."), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

const signed: Manifest.Signing = { kind: "release", key: Manifest.fingerprint(releaseKey) }

describe("delivery signing check", () => {
  test("passes release-signed evidence with every bundle and the recorded key", () => {
    expect(Delivery.signing(release(releaseKey), manifest(signed), ["gateway", "execution"])).toEqual([])
  })

  test("checks only the delivered artifacts", () => {
    const gatewayOnly = manifest(signed, { kind: "unsigned" })
    expect(Delivery.signing(release(releaseKey), gatewayOnly, ["gateway"])).toEqual([])
    expect(Delivery.signing(release(releaseKey), gatewayOnly, ["gateway", "execution"])).toEqual([
      expect.stringContaining("execution: evidence is unsigned"),
    ])
  })

  test("refuses unsigned evidence and manifests from before signing provenance", () => {
    expect(Delivery.signing(release(undefined), manifest({ kind: "unsigned" }), ["gateway"])).toEqual([
      expect.stringContaining("cosign.pub is missing"),
      expect.stringContaining("predates signing provenance"),
    ])
  })

  test("refuses evidence signed with an ephemeral key", () => {
    const ephemeral: Manifest.Signing = { kind: "ephemeral", key: Manifest.fingerprint(otherKey) }
    expect(Delivery.signing(release(otherKey), manifest(ephemeral), ["gateway"])).toEqual([
      expect.stringContaining("gateway: evidence is signed with an ephemeral key"),
    ])
  })

  test("refuses a release label whose key is not the delivered cosign.pub", () => {
    // An ephemeral key mislabeled `release` (BYMORNING_SIGNING_KIND=release outside the workflow).
    const mislabeled: Manifest.Signing = { kind: "release", key: Manifest.fingerprint(otherKey) }
    const problems = Delivery.signing(release(releaseKey), manifest(mislabeled), ["gateway"])
    expect(problems).toContainEqual(
      expect.stringMatching(/cosign\.pub is sha256:[0-9a-f]+, but the evidence was signed/),
    )
  })

  test("refuses an evidence folder whose cosign.pub differs", () => {
    const problems = Delivery.signing(release(releaseKey, { evidenceKey: otherKey }), manifest(signed), ["gateway"])
    expect(problems).toEqual([expect.stringContaining("1.2.0/gateway/cosign.pub is sha256:")])
  })

  test.each([
    `1.2.0/gateway/bymorning-${commit}.tar.bundle`,
    "1.2.0/gateway/SHA256SUMS.bundle",
    "1.2.0/gateway/provenance.intoto.json.bundle",
    "1.2.0/gateway/openvex.json.bundle",
    `1.2.0/execution/bymorning-code-interpreter-${commit}.tar.bundle`,
  ])("refuses evidence without %s", (bundle) => {
    const problems = Delivery.signing(release(releaseKey, { drop: bundle }), manifest(signed), ["gateway", "execution"])
    expect(problems).toEqual([expect.stringContaining(`${bundle} is missing`)])
  })
})

describe("delivery key rotation", () => {
  const key = (content: string) => {
    const path = join(scratch, `key-${counter++}.pub`)
    writeFileSync(path, content)
    return path
  }

  test("a target without a key, or with the same key, is no rotation", () => {
    expect(Delivery.rotation(join(scratch, "absent.pub"), key(releaseKey))).toBeUndefined()
    expect(Delivery.rotation(key(releaseKey), key(releaseKey.replaceAll("\n", "\r\n")))).toBeUndefined()
  })

  test("a different key reports both fingerprints", () => {
    expect(Delivery.rotation(key(releaseKey), key(otherKey))).toEqual({
      before: Manifest.fingerprint(releaseKey),
      after: Manifest.fingerprint(otherKey),
    })
  })

  test("removing the target's key is a rotation too", () => {
    expect(Delivery.rotation(key(releaseKey), join(scratch, "absent.pub"))).toEqual({
      before: Manifest.fingerprint(releaseKey),
      after: "none",
    })
  })
})

describe("delivery lineage", () => {
  const git = (cwd: string, ...argv: Array<string>) => {
    const result = spawnSync("git", argv, {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "test",
        GIT_COMMITTER_EMAIL: "test@example.com",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    })
    if (result.status !== 0) throw new Error(`git ${argv.join(" ")}: ${result.stderr}`)
    return result.stdout.trim()
  }
  const write = (root: string, files: Record<string, string>) => {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true })
      writeFileSync(join(root, path), content)
    }
  }
  const pkg = (version: string, extra = "") =>
    `{\n  "name": "bymorning",\n  "version": "${version}",\n  "private": true${extra}\n}\n`
  /** A repository at the release build; returns it and the build revision. */
  const build = () => {
    const root = join(scratch, `repo-${counter++}`)
    mkdirSync(root)
    git(root, "init", "-q", "-b", "dev")
    write(root, {
      "package.json": pkg("1.2.0"),
      "app/host/package.json": pkg("1.2.0"),
      "CHANGELOG.md": "# 1.2.0\n",
      "installers/azure/main.tf": "",
      "script/release.ts": "",
    })
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "build")
    return { root, revision: git(root, "rev-parse", "HEAD") }
  }
  const commit = (root: string, files: Record<string, string>) => {
    write(root, files)
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "change")
  }

  test("the build commit itself is deliverable", () => {
    const { root, revision } = build()
    expect(Delivery.lineage(root, revision)).toEqual([])
  })

  test("the documented flow (build, then commit the manifest, evidence, changelog, version bump) is deliverable", () => {
    const { root, revision } = build()
    commit(root, {
      "release/manifest.json": "{}",
      "release/1.2.0/gateway/SHA256SUMS": "",
      "docs/security/evidence/vulnerability-triage.md": "triage",
      "CHANGELOG.md": "# 1.2.1\n# 1.2.0\n",
    })
    commit(root, { "package.json": pkg("1.2.1"), "app/host/package.json": pkg("1.2.1") })
    expect(Delivery.lineage(root, revision)).toEqual([])
  })

  test("refuses code changed since the build", () => {
    const { root, revision } = build()
    commit(root, { "release/manifest.json": "{}", "installers/azure/main.tf": "resource {}", "script/new.ts": "" })
    expect(Delivery.lineage(root, revision)).toEqual([
      expect.stringContaining("installers/azure/main.tf changed since"),
      expect.stringContaining("script/new.ts changed since"),
    ])
  })

  test("refuses package.json changes beyond the version line", () => {
    const { root, revision } = build()
    commit(root, { "package.json": pkg("1.2.1", ',\n  "dependencies": { "left-pad": "1.0.0" }') })
    expect(Delivery.lineage(root, revision)).toEqual([
      expect.stringContaining('package.json changed beyond its "version"'),
    ])
  })

  test("refuses a revision that is not an ancestor of HEAD", () => {
    const { root, revision } = build()
    git(root, "checkout", "-q", "-b", "other", `${revision}`)
    commit(root, { "release/manifest.json": "{}" })
    const side = git(root, "rev-parse", "HEAD")
    git(root, "checkout", "-q", "dev")
    commit(root, { "CHANGELOG.md": "# next\n" })
    expect(Delivery.lineage(root, side)).toEqual([expect.stringContaining("is not an ancestor of HEAD")])
  })

  test("refuses a revision this checkout does not have", () => {
    const { root } = build()
    expect(Delivery.lineage(root, "0".repeat(40))).toEqual([expect.stringContaining("is not in this checkout")])
  })

  test.each([
    ["the version line", '@@ -3 +3 @@\n-  "version": "1.2.0",\n+  "version": "1.2.1",\n', true],
    ["nothing", "", true],
    ["a dependency", '@@ -5 +5 @@\n-    "effect": "1"\n+    "effect": "2"\n', false],
    [
      "a version and a script",
      '-  "version": "1.2.0",\n+  "version": "1.2.1",\n+  "postinstall": "curl x | sh",\n',
      false,
    ],
  ])("versionOnly: %s", (_name, diff, expected) => {
    expect(
      Delivery.versionOnly(`diff --git a/package.json b/package.json\n--- a/package.json\n+++ b/package.json\n${diff}`),
    ).toBe(expected)
  })
})
