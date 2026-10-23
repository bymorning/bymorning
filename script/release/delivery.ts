/**
 * The checks an installer export (installers/azure/export.ts) runs before it
 * delivers a release to a customer.
 * Each returns the problems it found; an empty list means deliverable. The
 * exports turn problems into a refusal unless the operator passes the matching
 * override (--allow-unsigned, --rotate-key).
 *
 *   const problems = Delivery.signing(release, manifest, ["gateway"])
 *   const change = Delivery.rotation(join(target, "release/cosign.pub"), join(release, "cosign.pub"))
 *   const drift = Delivery.lineage(repository, manifest.revision)
 */
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
// `.js` so the packages/server tests can import this module under their tsconfig; Bun resolves it to manifest.ts.
import { Manifest } from "./manifest.js"

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

  /**
   * Every delivered artifact is signed with the release key: `signing.kind` is
   * `release`, every bundle sign.ts writes is present, and both the release
   * directory's cosign.pub and the evidence folder's cosign.pub have the
   * fingerprint the manifest records.
   */
  export const signing = (release: string, manifest: Manifest.Manifest, kinds: ReadonlyArray<Manifest.Kind>) => {
    const problems: Array<string> = []
    const pub = join(release, "cosign.pub")
    const delivered = key(pub)
    if (delivered === undefined) problems.push(`${pub} is missing or is not a PEM public key`)
    for (const kind of kinds) {
      const artifact = manifest.artifacts[kind]
      const signing = artifact.signing
      if (signing.kind !== "release") {
        problems.push(
          signing.kind === "unsigned"
            ? `${kind}: evidence is unsigned (or the manifest predates signing provenance)`
            : `${kind}: evidence is signed with an ephemeral key ${signing.key}, not the release key`,
        )
        continue
      }
      for (const bundle of bundles(release, artifact))
        if (!existsSync(bundle)) problems.push(`${kind}: ${bundle} is missing`)
      if (delivered !== undefined && delivered !== signing.key)
        problems.push(`${kind}: ${pub} is ${delivered}, but the evidence was signed by ${signing.key}`)
      const evidence = join(release, artifact.evidence, "cosign.pub")
      const own = key(evidence)
      if (own !== signing.key) problems.push(`${kind}: ${evidence} is ${own ?? "missing"}, not ${signing.key}`)
    }
    return problems
  }

  /**
   * Whether delivering `next` would replace the key at `current` (the
   * cosign.pub already in the export target) with a different one. Returns
   * both fingerprints when it would; undefined when the target has no key yet
   * or the keys are the same.
   */
  export const rotation = (current: string, next: string) => {
    if (!existsSync(current)) return undefined
    const before = key(current) ?? "unreadable"
    const after = key(next) ?? "none"
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
