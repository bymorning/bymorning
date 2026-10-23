#!/usr/bin/env bun
/**
 * SLSA v1 provenance statement (in-toto) for the release tarball. Records the
 * source repository and commit, the digest-pinned base images (parsed from the
 * Dockerfile, the single source of truth), and the bun.lock hash. Written to
 * --out/provenance.intoto.json; sign.ts signs it.
 *
 *   bun script/security/provenance.ts --tarball <oci.tar> --digest sha256:<image> \
 *     --root <repo> --version <semver> --commit <short12> --out <dir>
 *
 * The buildType and builder identifiers are installer-neutral: one release
 * serves every installer, and the statement ships in every customer package.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { fail, git, option, sha256File } from "./lib.ts"

/** FROM lines with digest pins, in file order (build stage first). */
const baseImages = (dockerfile: string) => {
  const text = readFileSync(dockerfile, "utf8")
  const images: Array<{ name: string; digest: string }> = []
  for (const match of text.matchAll(/^FROM\s+(?:--platform=\S+\s+)?(\S+?)@sha256:([0-9a-f]{64})/gm)) {
    images.push({ name: match[1]!, digest: `sha256:${match[2]}` })
  }
  if (images.length < 2) fail(`${dockerfile}: expected digest-pinned FROM lines for the build and runtime stages`)
  return images
}

export const main = (args: string[]) => {
  const tarball = option(args, "tarball") ?? usage()
  const digest = option(args, "digest") ?? usage()
  const root = option(args, "root") ?? usage()
  const version = option(args, "version") ?? usage()
  option(args, "commit") ?? usage() // required for interface parity; the full sha is derived from git
  const out = option(args, "out") ?? usage()
  if (option(args, "profile") !== undefined) fail("--profile was removed: one image serves every deployment")
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) fail(`--digest must be the image digest (sha256:...), got ${digest}`)

  const dockerfileName = "Dockerfile"
  const dockerfile = join(root, dockerfileName)
  const fullCommit = git(["rev-parse", "HEAD"], root)
  const commitTime = new Date(Number(git(["log", "-1", "--format=%ct"], root)) * 1000).toISOString()
  const images = baseImages(dockerfile)
  const tarballName = tarball.split("/").at(-1)!

  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [
      { name: tarballName, digest: { sha256: sha256File(tarball) } },
      { name: "bymorning-gateway", digest: { sha256: digest.slice("sha256:".length) } },
    ],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: "https://github.com/bymorning/bymorning/release#oci-tarball",
        externalParameters: {
          version,
          dockerfile: dockerfileName,
          platform: "linux/amd64",
          command: "docker buildx build --platform linux/amd64 --provenance=false --sbom=false --output type=oci",
        },
        internalParameters: { repository: "https://github.com/bymorning/bymorning" },
        resolvedDependencies: [
          { uri: "git+https://github.com/bymorning/bymorning", digest: { gitCommit: fullCommit } },
          ...images.map((image) => ({
            uri: `pkg:oci/${image.name}`,
            digest: { sha256: image.digest.slice("sha256:".length) },
          })),
          { name: "bun.lock", digest: { sha256: sha256File(join(root, "bun.lock")) } },
        ],
      },
      runDetails: {
        builder: {
          id: "https://github.com/bymorning/bymorning/script/release.ts",
          version: { "script/release.ts": sha256File(join(root, "script/release.ts")) },
        },
        metadata: {
          invocationId: randomUUID(),
          // Build content time, not wall-clock: the tarball is reproducible from the commit.
          startedOn: commitTime,
          finishedOn: new Date().toISOString(),
        },
        byproducts: [],
      },
    },
  }
  writeFileSync(join(out, "provenance.intoto.json"), JSON.stringify(statement, null, 2) + "\n")
  console.log(`provenance: wrote ${out}/provenance.intoto.json`)
}

const usage = (): never => {
  console.error(
    "usage: bun script/security/provenance.ts --tarball <oci.tar> --digest sha256:<image> --root <repo> --version <semver> --commit <short12> --out <dir>",
  )
  process.exit(1)
}

if (import.meta.main) main(process.argv.slice(2))
