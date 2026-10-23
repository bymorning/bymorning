/**
 * Which kind of key signs the release evidence, decided from the environment
 * script/security/sign.ts runs in. The result is recorded per artifact in
 * release/manifest.json (`Manifest.Signing`).
 *
 *   release    BYMORNING_COSIGN_KEY is the KMS release alias, or equals an
 *              explicit BYMORNING_RELEASE_KEY, or is a PEM key file and
 *              BYMORNING_SIGNING_KIND=release (set only by full-gate.yml's
 *              dispatch path that restores the real key)
 *   ephemeral  any other key
 *   unsigned   no key
 *
 *   Signing.classify(process.env) // "ephemeral"
 */
export namespace Signing {
  /** The KMS alias of the release key (script/release-key.sh). */
  export const ALIAS = "awskms:///alias/bymorning-release"

  export type Kind = "release" | "ephemeral" | "unsigned"

  export const classify = (env: Record<string, string | undefined>): Kind => {
    const key = env.BYMORNING_COSIGN_KEY
    if (key === undefined || key === "") return "unsigned"
    if (key.startsWith(ALIAS)) return "release"
    const named = env.BYMORNING_RELEASE_KEY
    if (named !== undefined && named !== "" && key === named) return "release"
    // The workflow marker vouches for a key file it restored, never for another KMS key.
    if (!key.startsWith("awskms://") && env.BYMORNING_SIGNING_KIND === "release") return "release"
    return "ephemeral"
  }
}
