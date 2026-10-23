#!/usr/bin/env bun
/**
 * SBOM of the release image, from the OCI tarball so the image digest is never
 * touched. Writes sbom-image.cyclonedx.json (CycloneDX 1.6) and
 * sbom-image.spdx.json (SPDX 2.3) into --out.
 *
 *   bun script/security/sbom-image.ts --tarball <oci.tar> --out <dir> [--name <source name>]
 *
 * --name is the SBOM's source name (default bymorning-gateway; the execution
 * image uses bymorning-code-interpreter).
 */
import { option, run } from "./lib.ts"

export const main = (args: string[]) => {
  const tarball = option(args, "tarball") ?? usage()
  const out = option(args, "out") ?? usage()
  const name = option(args, "name", "bymorning-gateway")!
  run("syft", [
    `oci-archive:${tarball}`,
    "--source-name",
    name,
    "-o",
    `cyclonedx-json@1.6=${out}/sbom-image.cyclonedx.json`,
    "-o",
    `spdx-json@2.3=${out}/sbom-image.spdx.json`,
  ])
  console.log(`sbom-image: wrote ${out}/sbom-image.cyclonedx.json and sbom-image.spdx.json`)
}

const usage = (): never => {
  console.error("usage: bun script/security/sbom-image.ts --tarball <oci.tar> --out <dir> [--name <source name>]")
  process.exit(1)
}

if (import.meta.main) main(process.argv.slice(2))
