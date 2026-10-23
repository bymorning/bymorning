#!/usr/bin/env bun
/**
 * Builds the release: the Gateway image (root Dockerfile) and the Code
 * Interpreter execution image (app/host/Dockerfile.execution) as linux/amd64
 * OCI tarballs, records both in release/manifest.json, and produces each
 * image's evidence folder (release/<version>/gateway/ and
 * release/<version>/execution/: SBOMs, vulnerability reports, SHA256SUMS,
 * cosign signatures when BYMORNING_COSIGN_KEY is set; the Gateway additionally
 * gets license, secret, static-analysis and audit reports, SLSA provenance and
 * the OpenVEX statement). One release command; every installer export reads
 * the manifest.
 *
 *   bun script/release.ts [--version <semver>] [--out <directory>] [--force]
 *                         [--skip-evidence] [--evidence-out <directory>]
 *                         [--only gateway|execution]
 *
 * --version overrides the root package.json version. --out is where the
 * tarballs and manifest.json land (default release/; tarballs are gitignored,
 * the manifest is committed). --evidence-out is the version folder the
 * gateway/ and execution/ evidence folders are written under (default
 * <out>/<version>/, where the manifest's `evidence` paths point); an existing one is refused without --force. --only
 * rebuilds one image for iteration and keeps the other artifact from the
 * manifest already in --out. --profile is not accepted: one image serves
 * every deployment.
 *
 * Each artifact's `signing` in the manifest starts `unsigned` and is set by the
 * evidence pipeline to the key that signed its evidence (release, ephemeral;
 * see script/security/sign.ts). --skip-evidence leaves it unsigned. Installer
 * exports refuse anything but release-signed evidence.
 *
 * Builds run from a clean tree without provenance or SBOM attestations so each
 * tarball holds one manifest whose digest is the image digest. The build is
 * stamped with the version and the commit time as SOURCE_DATE_EPOCH, so a
 * rebuild of the same commit reproduces the digests. Commit manifest.json and
 * the evidence folder, then deliver through an installer export
 * (installers/azure/export.ts).
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Manifest } from "./release/manifest.ts"

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const release = join(repository, "release")
const args = process.argv.slice(2)
const option = (name: string) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? undefined : (args[index + 1] ?? fail(`--${name} needs a value`))
}
if (args.includes("--profile")) fail("--profile was removed: one image serves every deployment")
const force = args.includes("--force")
const out = resolve(option("out") ?? release)
const version =
  option("version") ??
  (JSON.parse(readFileSync(join(repository, "package.json"), "utf8")) as { version?: string }).version ??
  fail("root package.json has no version")
if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version)) fail(`invalid version: ${version}`)
const only = option("only")
if (only !== undefined && only !== "gateway" && only !== "execution") fail("--only takes gateway or execution")
const kinds: ReadonlyArray<Manifest.Kind> = only === undefined ? ["gateway", "execution"] : [only]
// The manifest names each evidence folder relative to --out, so that is the default parent.
const evidenceOut = resolve(option("evidence-out") ?? join(out, version))
const skipEvidence = args.includes("--skip-evidence")

const commit = git(["rev-parse", "--short=12", "HEAD"])
const revision = git(["rev-parse", "HEAD"])
const epoch = Number(git(["log", "-1", "--format=%ct"]))
const created = new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")
if (git(["status", "--porcelain"]) !== "" && !force) fail("working tree is dirty; commit first or pass --force")
if (!skipEvidence) {
  for (const kind of kinds) {
    const folder = join(evidenceOut, kind)
    if (existsSync(folder) && !force) fail(`${folder} exists; pass --force to replace it`)
  }
}

/**
 * Per image: file name, Dockerfile, build context, and build arguments. The
 * Gateway is stamped with version, revision, and creation time (its Dockerfile
 * labels them); the execution image has no first-party content and is built
 * from an empty context with its layer timestamps rewritten to the commit time.
 */
const images: Record<
  Manifest.Kind,
  {
    tarball: string
    dockerfile: string
    context: "repository" | "empty"
    buildArgs: ReadonlyArray<string>
    output: string
  }
> = {
  gateway: {
    tarball: `bymorning-${commit}.tar`,
    dockerfile: "Dockerfile",
    context: "repository",
    buildArgs: [
      `BYMORNING_VERSION=${version}`,
      `REVISION=${revision}`,
      `CREATED=${created}`,
      `SOURCE_DATE_EPOCH=${epoch}`,
    ],
    output: "type=oci",
  },
  execution: {
    tarball: `bymorning-code-interpreter-${commit}.tar`,
    dockerfile: "app/host/Dockerfile.execution",
    context: "empty",
    buildArgs: [`SOURCE_DATE_EPOCH=${epoch}`],
    output: "type=oci,rewrite-timestamp=true",
  },
}

mkdirSync(out, { recursive: true })
const previous = only === undefined ? undefined : existing()
const built = {} as Record<Manifest.Kind, Manifest.Artifact>
for (const kind of kinds) built[kind] = build(kind)
const manifest: Manifest.Manifest = {
  schema: Manifest.SCHEMA,
  version,
  commit,
  revision,
  created,
  artifacts: {
    gateway: built.gateway ?? previous!.artifacts.gateway,
    execution: built.execution ?? previous!.artifacts.execution,
  },
}
console.log(Manifest.write(out, manifest))

if (skipEvidence) {
  console.log("evidence: skipped (--skip-evidence)")
} else {
  for (const kind of kinds) {
    const artifact = manifest.artifacts[kind]
    const result = spawnSync(
      "bun",
      [
        join(repository, "script/security/evidence.ts"),
        "--kind",
        kind,
        "--tarball",
        join(out, artifact.tarball),
        "--digest",
        artifact.digest,
        "--version",
        version,
        "--commit",
        commit,
        "--out",
        join(evidenceOut, kind),
        "--manifest",
        out,
      ],
      { stdio: "inherit" },
    )
    if (result.status !== 0) fail(`${kind} evidence pipeline failed`)
  }
  const signed = Manifest.read(out)
  for (const kind of ["gateway", "execution"] as const) {
    const signing = signed.artifacts[kind].signing
    console.log(`${kind}: ${signing.kind}${"key" in signing ? ` (${signing.key})` : ""}`)
  }
}

/** Builds one image into <out>/<tarball> and returns its manifest entry. */
function build(kind: Manifest.Kind): Manifest.Artifact {
  const image = images[kind]
  const tarball = join(out, image.tarball)
  const scratch = mkdtempSync(join(tmpdir(), `bymorning-release-${kind}-`))
  try {
    let context = repository
    if (image.context === "empty") {
      context = join(scratch, "context")
      mkdirSync(context)
    }
    console.log(`--- build ${kind} (${image.dockerfile})`)
    run(
      "docker",
      [
        "buildx",
        "build",
        "--platform",
        "linux/amd64",
        "--provenance=false",
        "--sbom=false",
        ...image.buildArgs.flatMap((arg) => ["--build-arg", arg]),
        "-f",
        join(repository, image.dockerfile),
        "--output",
        `${image.output},dest=${tarball}`,
        context,
      ],
      repository,
    )
    // The tarball is an OCI layout; its index names exactly one manifest.
    run("tar", ["-xf", tarball, "-C", scratch, "index.json"])
    const index = JSON.parse(readFileSync(join(scratch, "index.json"), "utf8")) as {
      manifests: Array<{ digest: string; platform?: { architecture: string; os: string } }>
    }
    if (index.manifests.length !== 1)
      fail(`${image.tarball}: expected one manifest in the tarball, found ${index.manifests.length}`)
    const [descriptor] = index.manifests
    const digest = descriptor!.digest
    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) fail(`${image.tarball}: unexpected digest ${digest}`)
    if (descriptor!.platform?.architecture !== "amd64" || descriptor!.platform?.os !== "linux")
      fail(`${image.tarball} is not linux/amd64`)
    console.log(`${tarball}\n${digest}`)
    return {
      tarball: image.tarball,
      digest,
      platform: "linux/amd64",
      dockerfile: image.dockerfile,
      evidence: `${version}/${kind}`,
      // The evidence pipeline records the key that signed (script/security/evidence.ts).
      signing: { kind: "unsigned" },
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** With --only, the manifest already in --out supplies the artifact not rebuilt. */
function existing(): Manifest.Manifest {
  if (!existsSync(join(out, Manifest.FILE)))
    fail(`--only needs ${join(out, Manifest.FILE)} from a build of both images; run without --only first`)
  const manifest = Manifest.read(out)
  if (manifest.version !== version || manifest.commit !== commit)
    fail(
      `${join(out, Manifest.FILE)} records ${manifest.version}@${manifest.commit}, not ${version}@${commit}; run without --only`,
    )
  return manifest
}

function git(argv: string[]) {
  return run("git", argv, repository).trim()
}
function run(bin: string, argv: string[], cwd?: string) {
  const result = spawnSync(bin, argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })
  if (result.status !== 0) fail(`${bin} ${argv.join(" ")} failed`)
  return result.stdout
}
function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
