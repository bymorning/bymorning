/**
 * Optional prebuilt Gateway image for `sst deploy`.
 *
 * A tested release is an OCI image identified by digest (script/release.ts).
 * Rebuilding the root `Dockerfile` during the deploy would produce a different
 * artifact, so an operator may pin the Gateway to the already pushed image with
 * `BYMORNING_IMAGE=<account>.dkr.ecr.<region>.amazonaws.com/<repository>@sha256:<digest>`.
 * Only immutable digest references are accepted: tags, other registries, and
 * malformed values fail before any resource is planned. Unset (or empty) keeps
 * the default source build, which is what every non-release stage uses.
 *
 * The override replaces only the Gateway container image. The migrator Lambda,
 * the web assets, and all other resources are still built from the checked-out
 * source, which must be the commit the image was released from.
 */
const pattern =
  /^(\d{12})\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com\/([a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*)@(sha256:[0-9a-f]{64})$/

export function releaseImage(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined
  if (!pattern.test(value))
    throw new Error("BYMORNING_IMAGE must be <account>.dkr.ecr.<region>.amazonaws.com/<repository>@sha256:<64 hex>")
  return value
}

/** The registry account named by a validated image must be the account being deployed to. */
export function releaseImageFor(value: string, accountID: string): string {
  const match = pattern.exec(value)
  if (match === null) throw new Error("BYMORNING_IMAGE is not a release image reference")
  if (match[1] !== accountID)
    throw new Error(`BYMORNING_IMAGE registry account ${match[1]} is not deployment account ${accountID}`)
  return value
}
