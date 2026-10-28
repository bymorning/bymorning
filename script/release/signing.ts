/**
 * How the release evidence is signed, decided from the environment
 * script/security/sign.ts runs in, and the policy that makes a signature a
 * release signature. The result is recorded per artifact in
 * release/manifest.json (`Manifest.Signing`).
 *
 *   keyless    Sigstore keyless signing with the GitHub Actions OIDC identity
 *              (BYMORNING_SIGN_KEYLESS=1). There is no key to store or rotate:
 *              the certificate names the workflow run that signed, and the
 *              signature is recorded in the public Rekor transparency log.
 *   ephemeral  a key file or KMS key (BYMORNING_COSIGN_KEY): a throwaway key for
 *              CI gate runs and local builds. Never delivered.
 *   unsigned   neither
 *
 * A keyless signature is a RELEASE signature only when the signer is
 * full-gate.yml running on a v* tag of this repository (`isRelease`). The
 * build records whichever identity signed; the installer export applies this
 * policy, so a signature from a branch run is recorded but refused.
 *
 *   Signing.mode(process.env) // "ephemeral"
 */
import { X509Certificate } from "node:crypto"

export namespace Signing {
  /** The OIDC issuer of GitHub Actions identities. */
  export const ISSUER = "https://token.actions.githubusercontent.com"

  /** The only signer identity accepted for a delivered release: this workflow, run on a version tag. */
  export const RELEASE_IDENTITY =
    /^https:\/\/github\.com\/bymorning\/bymorning\/\.github\/workflows\/full-gate\.yml@refs\/tags\/v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/

  /** The same policy as a `cosign verify-blob --certificate-identity-regexp` value (RE2 accepts the escaped slashes). */
  export const RELEASE_IDENTITY_PATTERN = RELEASE_IDENTITY.source

  export type Mode = "keyless" | "key" | "unsigned"

  export const mode = (env: Record<string, string | undefined>): Mode => {
    if (env.BYMORNING_SIGN_KEYLESS === "1") return "keyless"
    const key = env.BYMORNING_COSIGN_KEY
    return key === undefined || key === "" ? "unsigned" : "key"
  }

  /** Whether a keyless signer is an acceptable release signer. */
  export const isRelease = (identity: string, issuer: string) => issuer === ISSUER && RELEASE_IDENTITY.test(identity)

  /** The identity without its ref: the workflow, which stays the same from one release to the next. */
  export const workflow = (identity: string) => identity.replace(/@.*$/, "")

  /** The `release/signer.txt` a package ships: the pinned signer the customer-side scripts verify against. */
  export const record = (identity: string, issuer: string) =>
    [
      "# The identity and OIDC issuer that signed this release (Sigstore keyless signing).",
      "# Verify with: cosign verify-blob --bundle <file>.bundle --certificate-identity <identity> \\",
      "#   --certificate-oidc-issuer <issuer> <file>",
      `identity: ${identity}`,
      `issuer: ${issuer}`,
      "",
    ].join("\n")

  /** Reads `identity` and `issuer` back out of a `signer.txt`; undefined when either is missing. */
  export const parse = (text: string) => {
    const field = (name: string) => new RegExp(`^${name}: *(\\S.*?) *$`, "m").exec(text)?.[1]
    const identity = field("identity")
    const issuer = field("issuer")
    return identity === undefined || issuer === undefined ? undefined : { identity, issuer }
  }

  /**
   * The subject of the signing certificate in a Sigstore bundle (the workflow
   * URL for GitHub Actions identities). Reads both bundle layouts: a single
   * `certificate` and an `x509CertificateChain`.
   */
  export const bundleIdentity = (bundleText: string) => {
    const material = JSON.parse(bundleText)?.verificationMaterial
    const raw: unknown = material?.certificate?.rawBytes ?? material?.x509CertificateChain?.certificates?.[0]?.rawBytes
    if (typeof raw !== "string") throw new Error("the bundle carries no signing certificate (is it a key signature?)")
    const san = new X509Certificate(Buffer.from(raw, "base64")).subjectAltName ?? ""
    const uri = /(?:^|,\s*)URI:([^,\s]+)/.exec(san)?.[1]
    if (uri === undefined) throw new Error(`the signing certificate has no URI subject alternative name (${san})`)
    return uri
  }
}
