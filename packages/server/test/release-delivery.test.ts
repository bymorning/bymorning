import { spawnSync } from "node:child_process"
import { generateKeyPairSync } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, test } from "vitest"
import { Delivery } from "../../../script/release/delivery.js"
import { Manifest } from "../../../script/release/manifest.js"
import { Signing } from "../../../script/release/signing.js"

const scratch = mkdtempSync(join(tmpdir(), "release-delivery-test-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const pem = () =>
  generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ type: "spki", format: "pem" }).toString()
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
const identity = "https://github.com/bymorning/bymorning/.github/workflows/full-gate.yml@refs/tags/v1.2.0"
const issuer = Signing.ISSUER

/** A release directory laid out as script/release.ts writes it, signed keylessly as `signer`. */
const release = (
  options: { drop?: string; evidenceIdentity?: string; signer?: string | null; root?: boolean } = {},
) => {
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
    [`bymorning-${commit}.tar`]: "tarball",
    [`bymorning-code-interpreter-${commit}.tar`]: "tarball",
  }
  if (options.signer !== null) {
    const named = options.signer ?? identity
    files["signer.txt"] = Signing.record(named, issuer)
    files["1.2.0/gateway/signer.txt"] = Signing.record(options.evidenceIdentity ?? named, issuer)
    files["1.2.0/execution/signer.txt"] = Signing.record(named, issuer)
  }
  if (options.root) files["trusted_root.json"] = "{}"
  for (const [path, content] of Object.entries(files)) {
    if (path === options.drop) continue
    mkdirSync(join(dir, path, ".."), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

const signed: Manifest.Signing = { kind: "keyless", identity, issuer }

describe("delivery signing check", () => {
  test("passes evidence signed by a release signer with every bundle and the recorded signer", () => {
    expect(Delivery.signing(release(), manifest(signed), ["gateway", "execution"])).toEqual([])
  })

  test("checks only the delivered artifacts", () => {
    const gatewayOnly = manifest(signed, { kind: "unsigned" })
    expect(Delivery.signing(release(), gatewayOnly, ["gateway"])).toEqual([])
    expect(Delivery.signing(release(), gatewayOnly, ["gateway", "execution"])).toEqual([
      expect.stringContaining("execution: evidence is unsigned"),
    ])
  })

  test("refuses unsigned evidence and manifests from before signing provenance", () => {
    expect(Delivery.signing(release({ signer: null }), manifest({ kind: "unsigned" }), ["gateway"])).toEqual([
      expect.stringContaining("predates signing provenance"),
    ])
  })

  test("refuses evidence signed with a throwaway key", () => {
    const ephemeral: Manifest.Signing = { kind: "ephemeral", key: Manifest.fingerprint(otherKey) }
    expect(Delivery.signing(release(), manifest(ephemeral), ["gateway"])).toEqual([
      expect.stringContaining("gateway: evidence is signed with a throwaway key"),
    ])
  })

  test.each([
    ["a branch run", "https://github.com/bymorning/bymorning/.github/workflows/full-gate.yml@refs/heads/dev"],
    ["another workflow", "https://github.com/bymorning/bymorning/.github/workflows/ci.yml@refs/tags/v1.2.0"],
    ["a fork", "https://github.com/someone/bymorning/.github/workflows/full-gate.yml@refs/tags/v1.2.0"],
  ])("refuses a keyless signature from %s", (_name, other) => {
    const problems = Delivery.signing(
      release({ signer: other }),
      manifest({ kind: "keyless", identity: other, issuer }),
      ["gateway"],
    )
    expect(problems).toEqual([expect.stringContaining("which is not full-gate.yml on a v* tag")])
  })

  test("refuses a keyless signature vouched for by another issuer", () => {
    const problems = Delivery.signing(
      release(),
      manifest({ kind: "keyless", identity, issuer: "https://accounts.google.com" }),
      ["gateway"],
    )
    expect(problems).toContainEqual(expect.stringContaining("which is not full-gate.yml on a v* tag"))
  })

  test("refuses a release without its signer.txt, at the root and in the evidence folder", () => {
    const missing = Delivery.signing(release({ signer: null }), manifest(signed), ["gateway"])
    expect(missing).toEqual([
      expect.stringMatching(/signer\.txt is missing or names no signer/),
      expect.stringMatching(/1\.2\.0\/gateway\/signer\.txt is missing or names no signer/),
    ])
  })

  test("refuses an evidence folder whose signer.txt names another identity", () => {
    const other = "https://github.com/bymorning/bymorning/.github/workflows/full-gate.yml@refs/tags/v9.9.9"
    const problems = Delivery.signing(release({ evidenceIdentity: other }), manifest(signed), ["gateway"])
    expect(problems).toEqual([expect.stringContaining(`1.2.0/gateway/signer.txt names ${other}`)])
  })

  test.each([
    `1.2.0/gateway/bymorning-${commit}.tar.bundle`,
    "1.2.0/gateway/SHA256SUMS.bundle",
    "1.2.0/gateway/provenance.intoto.json.bundle",
    "1.2.0/gateway/openvex.json.bundle",
    `1.2.0/execution/bymorning-code-interpreter-${commit}.tar.bundle`,
  ])("refuses evidence without %s", (bundle) => {
    const problems = Delivery.signing(release({ drop: bundle }), manifest(signed), ["gateway", "execution"])
    expect(problems).toEqual([expect.stringContaining(`${bundle} is missing`)])
  })
})

describe("delivery signature verification", () => {
  /** A cosign stand-in on PATH: records each call and fails any file named in `reject`. */
  const withCosign = <T>(reject: string, body: (calls: () => Array<string>) => T) => {
    const bin = join(scratch, `bin-${counter++}`)
    const log = join(bin, "calls.txt")
    mkdirSync(bin)
    writeFileSync(
      join(bin, "cosign"),
      `#!/bin/sh\n[ "$1" = version ] && exit 0\necho "$*" >> "${log}"\ncase "$*" in *"${reject}") echo "bad signature" >&2; exit 1;; esac\nexit 0\n`,
      { mode: 0o755 },
    )
    const before = process.env.PATH
    process.env.PATH = `${bin}:${before}`
    try {
      return body(() => spawnSync("cat", [log], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean))
    } finally {
      process.env.PATH = before
    }
  }

  test("verifies the tarball and every signed file against the recorded identity and issuer", () => {
    withCosign("never-matches", (calls) => {
      expect(Delivery.verification(release(), manifest(signed), ["gateway", "execution"])).toEqual([])
      const lines = calls()
      // gateway: tarball, SHA256SUMS, provenance, openvex; execution: tarball, SHA256SUMS
      expect(lines).toHaveLength(6)
      for (const line of lines)
        expect(line).toContain(`--certificate-identity ${identity} --certificate-oidc-issuer ${issuer}`)
      expect(lines.some((line) => line.endsWith(`bymorning-${commit}.tar`))).toBe(true)
      expect(lines.some((line) => line.endsWith("openvex.json"))).toBe(true)
      expect(lines.join("\n")).not.toContain("--trusted-root")
    })
  })

  test("verifies offline against the release's trusted root when it ships one", () => {
    withCosign("never-matches", (calls) => {
      const dir = release({ root: true })
      expect(Delivery.verification(dir, manifest(signed), ["gateway"])).toEqual([])
      for (const line of calls()) expect(line).toContain(`--trusted-root ${join(dir, "trusted_root.json")}`)
    })
  })

  test("a signature cosign rejects is a problem naming the file", () => {
    withCosign("SHA256SUMS", () => {
      const problems = Delivery.verification(release(), manifest(signed), ["gateway"])
      expect(problems).toEqual([expect.stringMatching(/gateway: cosign could not verify .*SHA256SUMS: bad signature/)])
    })
  })

  test("a missing bundle is left to the signing check, not reported twice", () => {
    withCosign("never-matches", () => {
      const dir = release({ drop: "1.2.0/gateway/openvex.json.bundle" })
      expect(Delivery.verification(dir, manifest(signed), ["gateway"])).toEqual([])
    })
  })

  test("evidence that is not keyless is not verified here", () => {
    withCosign("never-matches", (calls) => {
      expect(Delivery.verification(release(), manifest({ kind: "unsigned" }), ["gateway"])).toEqual([])
      expect(calls()).toEqual([])
    })
  })

  test("without cosign nothing is verified, which is a problem", () => {
    const before = process.env.PATH
    process.env.PATH = join(scratch, "no-such-bin")
    try {
      expect(Delivery.verification(release(), manifest(signed), ["gateway"])).toEqual([
        expect.stringContaining("cosign is not on PATH"),
      ])
    } finally {
      process.env.PATH = before
    }
  })
})

describe("delivery signer rotation", () => {
  const workflow = "https://github.com/bymorning/bymorning/.github/workflows/full-gate.yml"
  const keyless = (who: string, from = issuer) => {
    const dir = join(scratch, `pinned-${counter++}`)
    mkdirSync(dir)
    writeFileSync(join(dir, "signer.txt"), Signing.record(who, from))
    return dir
  }
  const keyed = (content: string) => {
    const dir = join(scratch, `pinned-${counter++}`)
    mkdirSync(dir)
    writeFileSync(join(dir, "cosign.pub"), content)
    return dir
  }
  const empty = () => {
    const dir = join(scratch, `pinned-${counter++}`)
    mkdirSync(dir)
    return dir
  }

  test("a target that pins nothing yet is no rotation", () => {
    expect(Delivery.rotation(join(scratch, "absent"), keyless(`${workflow}@refs/tags/v1.0.0`))).toBeUndefined()
    expect(Delivery.rotation(empty(), keyless(`${workflow}@refs/tags/v1.0.0`))).toBeUndefined()
  })

  test("a new release tag from the same workflow is no rotation", () => {
    expect(
      Delivery.rotation(keyless(`${workflow}@refs/tags/v1.0.0`), keyless(`${workflow}@refs/tags/v1.1.0`)),
    ).toBeUndefined()
  })

  test("another workflow is a rotation", () => {
    const other = "https://github.com/someone/else/.github/workflows/full-gate.yml"
    const change = Delivery.rotation(keyless(`${workflow}@refs/tags/v1.0.0`), keyless(`${other}@refs/tags/v1.0.0`))
    expect(change).toEqual({ before: `keyless ${workflow} (${issuer})`, after: `keyless ${other} (${issuer})` })
  })

  test("another issuer is a rotation", () => {
    const change = Delivery.rotation(
      keyless(`${workflow}@refs/tags/v1.0.0`),
      keyless(`${workflow}@refs/tags/v1.0.0`, "https://accounts.google.com"),
    )
    expect(change?.after).toContain("https://accounts.google.com")
  })

  test("moving from a key to keyless signing is a rotation", () => {
    expect(Delivery.rotation(keyed(otherKey), keyless(`${workflow}@refs/tags/v1.0.0`))).toEqual({
      before: `key ${Manifest.fingerprint(otherKey)}`,
      after: `keyless ${workflow} (${issuer})`,
    })
  })

  test("the same key, even with CRLF line endings, is no rotation", () => {
    expect(Delivery.rotation(keyed(otherKey), keyed(otherKey.replaceAll("\n", "\r\n")))).toBeUndefined()
  })

  test("removing the target's signer is a rotation too", () => {
    expect(Delivery.rotation(keyless(`${workflow}@refs/tags/v1.0.0`), empty())).toEqual({
      before: `keyless ${workflow} (${issuer})`,
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
