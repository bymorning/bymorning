// Verifies a release OCI archive (the tarball script/release.ts writes) BEFORE it
// is loaded into Docker or run. Release test tooling only; it depends on Node and
// the system `tar`, nothing else.
//
//   node oci-archive.mjs <tarball> --digest sha256:<manifest> --version <v> --commit <12hex> \
//        --terraform <ecs.tf> --extract <dir>
//
// Rejects, with a non-zero exit and one line on stderr:
//   * unsafe archive members (absolute or ".." paths, links, anything outside the
//     OCI layout: oci-layout, index.json, blobs/sha256/<64 hex>)
//   * an index that does not name exactly one linux/amd64 image manifest, or whose
//     manifest digest is not the expected one (release/manifest.json)
//   * any blob whose sha256 or size differs from its descriptor, and any blob that
//     the manifest, config, or layers do not reference
//   * an image config whose version/revision labels, user, entrypoint, or command
//     differ from what the release records and the Terraform task definition uses
// On success prints the verified facts as JSON and extracts the layout to --extract.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export class ArchiveError extends Error {}
const reject = (message) => {
  throw new ArchiveError(message)
}

const OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json"
const MEMBER = /^(?:oci-layout|index\.json|blobs|blobs\/sha256|blobs\/sha256\/[0-9a-f]{64})$/

const tar = (args) => {
  const result = spawnSync("tar", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) reject(`tar ${args[0]} failed: ${result.stderr.trim() || "cannot read the archive"}`)
  return result.stdout
}

/** Lists and vets every archive member without extracting anything. */
export const members = (tarball) => {
  const names = tar(["-tf", tarball]).split("\n").filter(Boolean)
  const kinds = tar(["-tvf", tarball])
    .split("\n")
    .filter(Boolean)
    .map((line) => line[0])
  if (names.length !== kinds.length) reject("archive listing is inconsistent")
  names.forEach((raw, index) => {
    const name = raw.replace(/^\.\//, "").replace(/\/$/, "")
    if (name === "" || name === ".") return
    if (!MEMBER.test(name)) reject(`unexpected archive member: ${raw}`)
    if (kinds[index] !== "-" && kinds[index] !== "d")
      reject(`archive member is not a regular file or directory: ${raw}`)
  })
  return names
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")

const blobPath = (layout, digest) => {
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) reject(`not a sha256 digest: ${digest}`)
  return join(layout, "blobs/sha256", digest.slice(7))
}

const verifyBlob = (layout, descriptor, what) => {
  const path = blobPath(layout, descriptor.digest)
  if (!existsSync(path)) reject(`${what} blob is missing: ${descriptor.digest}`)
  if (statSync(path).size !== descriptor.size)
    reject(`${what} blob size differs from its descriptor: ${descriptor.digest}`)
  if (`sha256:${sha256(path)}` !== descriptor.digest)
    reject(`${what} blob content does not match its digest: ${descriptor.digest}`)
  return path
}

/** Extracted layout -> verified facts. `expected` carries the release record. */
export const verifyLayout = (layout, expected) => {
  const marker = JSON.parse(readFileSync(join(layout, "oci-layout"), "utf8"))
  if (marker.imageLayoutVersion !== "1.0.0") reject("unsupported oci-layout version")
  const index = JSON.parse(readFileSync(join(layout, "index.json"), "utf8"))
  if (index.schemaVersion !== 2) reject("unsupported index schema")
  if (!Array.isArray(index.manifests) || index.manifests.length !== 1)
    reject(`index names ${index.manifests?.length ?? 0} manifests, expected exactly 1`)
  const [descriptor] = index.manifests
  if (descriptor.mediaType !== OCI_MANIFEST)
    reject(`index entry is ${descriptor.mediaType}, expected a single image manifest`)
  if (descriptor.digest !== expected.digest)
    reject(`manifest digest ${descriptor.digest} is not the released ${expected.digest}`)
  if (descriptor.platform?.os !== "linux" || descriptor.platform?.architecture !== "amd64")
    reject("index platform is not linux/amd64")

  const manifestFile = verifyBlob(layout, descriptor, "manifest")
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"))
  if (manifest.schemaVersion !== 2 || manifest.mediaType !== OCI_MANIFEST)
    reject("manifest is not an OCI image manifest")
  const configFile = verifyBlob(layout, manifest.config, "config")
  if (!Array.isArray(manifest.layers) || manifest.layers.length === 0) reject("manifest has no layers")
  manifest.layers.forEach((layer, position) => verifyBlob(layout, layer, `layer ${position}`))

  const referenced = new Set([
    descriptor.digest,
    manifest.config.digest,
    ...manifest.layers.map((layer) => layer.digest),
  ])
  for (const file of readdirSync(join(layout, "blobs/sha256"))) {
    if (!referenced.has(`sha256:${file}`)) reject(`unreferenced blob in the archive: sha256:${file}`)
  }

  const config = JSON.parse(readFileSync(configFile, "utf8"))
  if (config.os !== "linux" || config.architecture !== "amd64") reject("image config is not linux/amd64")
  if (config.rootfs?.diff_ids?.length !== manifest.layers.length) reject("layer count differs from rootfs diff_ids")
  const labels = config.config?.Labels ?? {}
  if (labels["org.opencontainers.image.version"] !== expected.version)
    reject(`version label ${labels["org.opencontainers.image.version"]} is not the released ${expected.version}`)
  const revision = labels["org.opencontainers.image.revision"] ?? ""
  if (!/^[0-9a-f]{40}$/.test(revision) || !revision.startsWith(expected.commit))
    reject(`revision label ${revision} does not start with the released commit ${expected.commit}`)
  if (labels["org.opencontainers.image.source"] !== "https://github.com/bymorning/bymorning")
    reject("source label differs")
  if (config.config?.User !== "65532:65532") reject(`image user is ${config.config?.User}, expected 65532:65532`)
  const entrypoint = config.config?.Entrypoint ?? null
  if (entrypoint !== null && entrypoint.length !== 0)
    reject(`image sets an entrypoint (${JSON.stringify(entrypoint)}); the task definition supplies commands`)
  const command = config.config?.Cmd ?? []
  if (JSON.stringify(command) !== JSON.stringify(["node", "/app/bymorning.mjs"]))
    reject(`image Cmd is ${JSON.stringify(command)}`)

  if (expected.terraform !== undefined) terraform(expected.terraform, command, config.config?.ExposedPorts ?? {})

  return {
    manifest: descriptor.digest,
    config: manifest.config.digest,
    layers: manifest.layers.length,
    version: expected.version,
    revision,
    command,
  }
}

/** A Terraform ECS task definition must run exactly what the image ships. */
const terraform = (file, command, ports) => {
  const text = readFileSync(file, "utf8")
  const migrate = /name\s*=\s*"migrate"[\s\S]*?command\s*=\s*(\[[^\]]*\])/.exec(text)
  if (migrate === null) reject(`${file}: no migrate command found`)
  const migration = JSON.parse(migrate[1])
  if (JSON.stringify(migration) !== JSON.stringify([...command, "migrate"]))
    reject(`${file}: migrate command ${migrate[1]} is not the image Cmd plus "migrate"`)
  const gateway = /name\s*=\s*"gateway"[\s\S]*?healthCheck/.exec(text)
  if (gateway === null) reject(`${file}: gateway container not found`)
  if (/\bcommand\s*=\s*\[/.test(gateway[0])) reject(`${file}: the gateway container overrides the image command`)
  if (!("3210/tcp" in ports)) reject(`image does not expose 3210/tcp (${Object.keys(ports).join(",")})`)
}

/** Vets the members, extracts, then verifies. Returns the facts. */
export const verify = (tarball, expected, extract) => {
  members(tarball)
  mkdirSync(extract, { recursive: true })
  tar(["-xf", tarball, "-C", extract, "--no-same-owner"])
  return verifyLayout(extract, expected)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [tarball, ...rest] = process.argv.slice(2)
  const option = (name) => {
    const at = rest.indexOf(`--${name}`)
    return at === -1 ? undefined : rest[at + 1]
  }
  try {
    const expected = {
      digest: option("digest"),
      version: option("version"),
      commit: option("commit"),
      terraform: option("terraform"),
    }
    const extract = option("extract")
    if (!tarball || !expected.digest || !expected.version || !expected.commit || !extract)
      reject("usage: oci-archive.mjs <tarball> --digest --version --commit --extract [--terraform]")
    console.log(JSON.stringify(verify(tarball, expected, extract)))
  } catch (error) {
    if (!(error instanceof ArchiveError)) throw error
    console.error(`oci-archive: ${error.message}`)
    process.exit(1)
  }
}
