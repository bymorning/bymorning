/**
 * The release manifest, release/manifest.json: one record per release naming
 * the version, the source commit, and both OCI tarballs with their digests.
 * script/release.ts writes it; the installer export (installers/azure/export.ts)
 * and the image tests read it. Each artifact's `evidence` is the folder under
 * release/ holding its signed evidence, and its `signing` records who signed
 * that evidence (script/security/sign.ts, script/release/signing.ts):
 *
 *   keyless    Sigstore keyless signing: `identity` is the certificate's
 *              subject (the workflow run) and `issuer` the OIDC issuer. Only
 *              full-gate.yml on a v* tag is a release signer; the installer
 *              export enforces that, the build only records what signed.
 *   ephemeral  a throwaway or development key, recorded by `key`, the SHA-256
 *              fingerprint of its public key (the DER bytes of cosign.pub; see
 *              `fingerprint`); never delivered to a customer
 *   unsigned   no signature
 *
 * Manifests written before `schema: 1` have no signing record and read as
 * `unsigned`: their signing provenance is unknown.
 *
 *   const manifest = Manifest.read("release")
 *   Manifest.write("release", manifest)
 */
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Schema } from "effect"

export namespace Manifest {
  export const FILE = "manifest.json"
  /** The manifest format written by this module. */
  export const SCHEMA = 1

  export const Kind = Schema.Literals(["gateway", "execution"])
  export type Kind = typeof Kind.Type

  export const Digest = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/))
  export const Commit = Schema.String.check(Schema.isPattern(/^[0-9a-f]{12}$/))
  export const Revision = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/))
  export const Version = Schema.String.check(Schema.isPattern(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/))
  /** SHA-256 of a public key's DER bytes, `sha256:<hex>`. */
  export const Fingerprint = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/))

  export const SigningKind = Schema.Literals(["keyless", "ephemeral", "unsigned"])
  export type SigningKind = typeof SigningKind.Type

  /** Who signed an artifact's evidence: a keyless identity, a throwaway key fingerprint, or nobody. */
  export const Signing = Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("keyless"),
      /** The signing certificate's subject, for example a workflow URL at a git ref. */
      identity: Schema.NonEmptyString,
      /** The OIDC issuer that vouched for the identity. */
      issuer: Schema.NonEmptyString,
    }),
    Schema.Struct({ kind: Schema.Literal("ephemeral"), key: Fingerprint }),
    Schema.Struct({ kind: Schema.Literal("unsigned") }),
  ])
  export type Signing = typeof Signing.Type

  /** One-line description of a signing record, for logs and refusals. */
  export const describe = (signing: Signing) =>
    signing.kind === "keyless"
      ? `keyless ${signing.identity}`
      : signing.kind === "ephemeral"
        ? `ephemeral key ${signing.key}`
        : "unsigned"

  export const Artifact = Schema.Struct({
    /** Tarball file name, relative to the release directory. */
    tarball: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._-]+\.tar$/)),
    /** OCI image manifest digest; the digest the installer verifies after pushing. */
    digest: Digest,
    platform: Schema.Literal("linux/amd64"),
    /** Dockerfile relative to the repository root. */
    dockerfile: Schema.String,
    /** Evidence folder relative to the release directory, for example `1.2.0/gateway`. */
    evidence: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._-]+\/(?:gateway|execution)$/)),
    /** Who signed the evidence folder. */
    signing: Signing,
  })
  export type Artifact = typeof Artifact.Type

  /** The schema of release/manifest.json. */
  export const Document = Schema.Struct({
    schema: Schema.Literal(SCHEMA),
    version: Version,
    commit: Commit,
    revision: Revision,
    /** Build content time (the commit time), ISO 8601. */
    created: Schema.String,
    artifacts: Schema.Struct({ gateway: Artifact, execution: Artifact }),
  })
  export type Manifest = typeof Document.Type

  const decode = Schema.decodeUnknownSync(Document, { errors: "all" })
  const encode = Schema.encodeSync(Document)

  /**
   * Manifests from before signing provenance carry no `schema` and no
   * `signing`; they read as schema 1 with every artifact `unsigned`.
   */
  const upgrade = (value: unknown): unknown => {
    if (typeof value !== "object" || value === null || Array.isArray(value) || "schema" in value) return value
    const legacy = value as { artifacts?: unknown }
    const artifacts =
      typeof legacy.artifacts === "object" && legacy.artifacts !== null && !Array.isArray(legacy.artifacts)
        ? Object.fromEntries(
            Object.entries(legacy.artifacts).map(([kind, artifact]) => [
              kind,
              typeof artifact === "object" && artifact !== null && !("signing" in artifact)
                ? { ...artifact, signing: { kind: "unsigned" } }
                : artifact,
            ]),
          )
        : legacy.artifacts
    return { schema: SCHEMA, ...value, artifacts }
  }

  /** Parses manifest text; throws a schema error naming every problem. */
  export const parse = (text: string): Manifest => decode(upgrade(JSON.parse(text)))

  /** Serializes a manifest as the JSON written to release/manifest.json. */
  export const print = (manifest: Manifest) => JSON.stringify(encode(manifest), null, 2) + "\n"

  /** Reads <releaseDir>/manifest.json. */
  export const read = (releaseDir: string): Manifest => parse(readFileSync(join(releaseDir, FILE), "utf8"))

  /** Writes <releaseDir>/manifest.json and returns its path. */
  export const write = (releaseDir: string, manifest: Manifest) => {
    const path = join(releaseDir, FILE)
    writeFileSync(path, print(manifest))
    return path
  }

  /**
   * The fingerprint of a PEM public key (cosign.pub): SHA-256 of its DER
   * bytes, so line endings and trailing whitespace do not change it.
   */
  export const fingerprint = (pem: string | Buffer) => {
    const text = pem.toString()
    const match = /-----BEGIN PUBLIC KEY-----([A-Za-z0-9+/=\s]+)-----END PUBLIC KEY-----/.exec(text)
    if (!match) throw new Error("not a PEM public key")
    const der = Buffer.from(match[1]!.replace(/\s+/g, ""), "base64")
    return `sha256:${createHash("sha256").update(der).digest("hex")}`
  }

  /**
   * The `image*.txt` record earlier releases shipped and the customer scripts
   * (mirror.sh) still read. Exports materialize it from the manifest.
   */
  export const record = (manifest: Manifest, kind: Kind, header: ReadonlyArray<string>) => {
    const artifact = manifest.artifacts[kind]
    return [
      ...header.map((line) => `# ${line}`),
      `# built from bymorning/bymorning@${manifest.commit}`,
      `version: ${manifest.version}`,
      `tarball: ${artifact.tarball}`,
      `digest: ${artifact.digest}`,
      "",
    ].join("\n")
  }
}
