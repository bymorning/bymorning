/**
 * The checks an installer export (installers/azure/export.ts) runs before it
 * delivers a release to a customer.
 * Each returns the problems it found; an empty list means deliverable. The
 * exports turn problems into a refusal unless the operator passes the matching
 * override (--allow-unsigned, --rotate-signer).
 *
 *   const problems = Delivery.signing(release, manifest, ["gateway"])
 *   const unverified = Delivery.verification(release, manifest, ["gateway"])
 *   const change = Delivery.rotation(join(target, "release"), release)
 *   const drift = Delivery.lineage(repository, manifest.revision)
 */
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
// `.js` so the packages/server tests can import this module under their tsconfig; Bun resolves it to manifest.ts.
import { Manifest } from "./manifest.js"
import { Signing } from "./signing.js"

export namespace Delivery {
  /** The marker an export writes into its SOURCE/README header when --allow-unsigned overrode the signing check. */
  export const REHEARSAL = "UNSIGNED REHEARSAL"

  /** The cosign bundles an artifact's evidence folder must carry: one per signed file sign.ts signs. */
  export const bundles = (release: string, artifact: Manifest.Artifact) => {
    const evidence = join(release, artifact.evidence)
    return [
      `${artifact.tarball}.bundle`,
      "SHA256SUMS.bundle",
      ...["provenance.intoto.json", "openvex.json"]
        .filter((file) => existsSync(join(evidence, file)))
        .map((file) => `${file}.bundle`),
    ].map((file) => join(evidence, file))
  }

  /** The fingerprint of a cosign.pub file, or undefined when it is missing or not a PEM public key. */
  export const key = (path: string) => {
    if (!existsSync(path)) return undefined
    try {
      return Manifest.fingerprint(readFileSync(path))
    } catch {
      return undefined
    }
  }

  /** The signer a `signer.txt` file names, or undefined when it is missing or malformed. */
  export const signer = (path: string) => {
    if (!existsSync(path)) return undefined
    return Signing.parse(readFileSync(path, "utf8"))
  }

  /**
   * Every delivered artifact is signed by a release signer: `signing.kind` is
   * `keyless`, the recorded identity is this repository's full-gate.yml on a
   * v* tag (`Signing.isRelease`), every bundle sign.ts writes is present, and
   * both the release directory's and the evidence folder's signer.txt name the
   * identity and issuer the manifest records. This checks what is recorded and
   * shipped; `verification` checks the signatures themselves.
   */
  export const signing = (release: string, manifest: Manifest.Manifest, kinds: ReadonlyArray<Manifest.Kind>) => {
    const problems: Array<string> = []
    for (const kind of kinds) {
      const artifact = manifest.artifacts[kind]
      const signing = artifact.signing
      if (signing.kind !== "keyless") {
        problems.push(
          signing.kind === "unsigned"
            ? `${kind}: evidence is unsigned (or the manifest predates signing provenance)`
            : `${kind}: evidence is signed with a throwaway key ${signing.key}, not by a release signer`,
        )
        continue
      }
      if (!Signing.isRelease(signing.identity, signing.issuer))
        problems.push(
          `${kind}: signed by ${signing.identity} (${signing.issuer}), which is not full-gate.yml on a v* tag of bymorning/bymorning`,
        )
      for (const bundle of bundles(release, artifact))
        if (!existsSync(bundle)) problems.push(`${kind}: ${bundle} is missing`)
      for (const file of [join(release, "signer.txt"), join(release, artifact.evidence, "signer.txt")]) {
        const named = signer(file)
        if (named === undefined) problems.push(`${kind}: ${file} is missing or names no signer`)
        else if (named.identity !== signing.identity || named.issuer !== signing.issuer)
          problems.push(`${kind}: ${file} names ${named.identity}, but the evidence was signed by ${signing.identity}`)
      }
    }
    return problems
  }

  /**
   * Verifies every signature with cosign: the tarball and each signed evidence
   * file against the recorded identity and issuer, offline when the release
   * carries a trusted_root.json. A bundle that does not verify, or no cosign
   * on PATH, is a problem; evidence nobody checked is not delivered.
   */
  export const verification = (release: string, manifest: Manifest.Manifest, kinds: ReadonlyArray<Manifest.Kind>) => {
    const problems: Array<string> = []
    const cosign = spawnSync("cosign", ["version"], { encoding: "utf8" })
    if (cosign.error || cosign.status !== 0) return ["cosign is not on PATH, so the signatures cannot be verified"]
    const root = join(release, "trusted_root.json")
    for (const kind of kinds) {
      const artifact = manifest.artifacts[kind]
      const signing = artifact.signing
      if (signing.kind !== "keyless") continue
      const evidence = join(release, artifact.evidence)
      const signed = [
        [join(release, artifact.tarball), join(evidence, `${artifact.tarball}.bundle`)],
        ...["SHA256SUMS", "provenance.intoto.json", "openvex.json"]
          .filter((file) => existsSync(join(evidence, file)))
          .map((file) => [join(evidence, file), join(evidence, `${file}.bundle`)] as const),
      ]
      for (const [file, bundle] of signed) {
        if (!existsSync(bundle)) continue // already reported by `signing`
        const result = spawnSync(
          "cosign",
          [
            "verify-blob",
            "--bundle",
            bundle,
            "--certificate-identity",
            signing.identity,
            "--certificate-oidc-issuer",
            signing.issuer,
            ...(existsSync(root) ? ["--trusted-root", root] : []),
            file,
          ],
          { encoding: "utf8" },
        )
        if (result.status !== 0)
          problems.push(`${kind}: cosign could not verify ${file}: ${(result.stderr || "").trim().split("\n").at(-1)}`)
      }
    }
    return problems
  }

  /** A short description of the signer a delivered release directory pins, or undefined when it pins none. */
  export const pinned = (release: string) => {
    const named = signer(join(release, "signer.txt"))
    if (named !== undefined) return `keyless ${Signing.workflow(named.identity)} (${named.issuer})`
    const fingerprint = key(join(release, "cosign.pub"))
    return fingerprint === undefined ? undefined : `key ${fingerprint}`
  }

  /**
   * Whether delivering the release in `next` would change the signer already
   * pinned by the package in `current`. The ref is not part of the signer: one
   * workflow signs every release from a different tag. Returns both
   * descriptions when the signer changes (a different workflow or issuer, or a
   * move between a key and keyless signing); undefined when the target pins
   * nothing yet or the signer is the same.
   */
  export const rotation = (current: string, next: string) => {
    const before = pinned(current)
    if (before === undefined) return undefined
    const after = pinned(next) ?? "none"
    return before === after ? undefined : { before, after }
  }

  /**
   * What may change between the release build and the checkout an export runs
   * from: the documented flow commits the manifest and evidence after the build,
   * and the next version bump touches the changelog and package versions.
   */
  export const RELEASE_PATHS = ["release/", "CHANGELOG.md", "docs/security/evidence/"] as const
  /** package.json files whose `version` line alone may change. */
  export const VERSION_FILES = ["package.json", "app/host/package.json"] as const

  /** Whether a zero-context unified diff of a package.json changes nothing but its `"version"` line. */
  export const versionOnly = (diff: string) =>
    diff
      .split("\n")
      .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)( |$)/.test(line))
      .every((line) => /^[+-]\s*"version"\s*:\s*"[^"]*",?\s*$/.test(line))

  /**
   * The checkout an export runs from holds the release build: `revision` is an
   * ancestor of HEAD, and every change since touches only RELEASE_PATHS or the
   * `version` line of VERSION_FILES. Returns the problems (empty when it holds).
   */
  export const lineage = (repository: string, revision: string) => {
    const git = (argv: ReadonlyArray<string>) => spawnSync("git", argv, { cwd: repository, encoding: "utf8" })
    if (git(["cat-file", "-e", `${revision}^{commit}`]).status !== 0)
      return [`the release revision ${revision} is not in this checkout (fetch it, or the history is shallow)`]
    const ancestor = git(["merge-base", "--is-ancestor", revision, "HEAD"])
    if (ancestor.status === 1) return [`the release revision ${revision} is not an ancestor of HEAD`]
    if (ancestor.status !== 0) return [`git merge-base failed: ${ancestor.stderr.trim()}`]
    const names = git(["diff", "--name-only", revision, "HEAD"])
    if (names.status !== 0) return [`git diff failed: ${names.stderr.trim()}`]
    const problems: Array<string> = []
    for (const file of names.stdout.split("\n").filter((line) => line !== "")) {
      if (RELEASE_PATHS.some((path) => (path.endsWith("/") ? file.startsWith(path) : file === path))) continue
      if ((VERSION_FILES as ReadonlyArray<string>).includes(file)) {
        const diff = git(["diff", "-U0", revision, "HEAD", "--", file])
        if (diff.status === 0 && versionOnly(diff.stdout)) continue
        problems.push(`${file} changed beyond its "version" line since ${revision.slice(0, 12)}`)
        continue
      }
      problems.push(`${file} changed since the release was built from ${revision.slice(0, 12)}`)
    }
    return problems
  }
}
