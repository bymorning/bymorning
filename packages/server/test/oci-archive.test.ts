import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, test } from "vitest"
// @ts-expect-error plain ESM release tooling without declarations
import { verify } from "./fixtures/oci-archive.mjs"

const scratch = mkdtempSync(join(tmpdir(), "oci-archive-test-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex")
const commit = "0123456789ab"
const revision = `${commit}${"0".repeat(28)}`
const ecs = join(scratch, "ecs.tf")
writeFileSync(
  ecs,
  `{ name = "migrate"
      command = ["node", "/app/bymorning.mjs", "migrate"]
    },
    { name = "gateway"
      healthCheck = {} }`,
)

type Options = {
  version?: string
  revision?: string
  cmd?: Array<string>
  user?: string
  platform?: string
  extraManifest?: boolean
  extraBlob?: boolean
  corrupt?: boolean
  link?: boolean
  outside?: boolean
  gatewayCommand?: boolean
}

let counter = 0
/** Builds a tiny but structurally real OCI archive and returns its path and manifest digest. */
const build = (options: Options = {}) => {
  const directory = join(scratch, `case-${++counter}`)
  const blobs = join(directory, "blobs/sha256")
  mkdirSync(blobs, { recursive: true })
  const put = (content: Buffer | string) => {
    const buffer = Buffer.from(content)
    writeFileSync(join(blobs, sha(buffer)), buffer)
    return { digest: `sha256:${sha(buffer)}`, size: buffer.length }
  }
  const layer = put("layer")
  const config = put(
    JSON.stringify({
      os: "linux",
      architecture: options.platform ?? "amd64",
      rootfs: { type: "layers", diff_ids: [layer.digest] },
      config: {
        User: options.user ?? "65532:65532",
        Cmd: options.cmd ?? ["node", "/app/bymorning.mjs"],
        ExposedPorts: { "3210/tcp": {} },
        Labels: {
          "org.opencontainers.image.version": options.version ?? "1.0.2-rc.1",
          "org.opencontainers.image.revision": options.revision ?? revision,
          "org.opencontainers.image.source": "https://github.com/bymorning/bymorning",
        },
      },
    }),
  )
  const manifest = put(
    JSON.stringify({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      config: { mediaType: "application/vnd.oci.image.config.v1+json", ...config },
      layers: [{ mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", ...layer }],
    }),
  )
  const descriptor = {
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    ...manifest,
    platform: { os: "linux", architecture: options.platform ?? "amd64" },
  }
  writeFileSync(join(directory, "oci-layout"), JSON.stringify({ imageLayoutVersion: "1.0.0" }))
  writeFileSync(
    join(directory, "index.json"),
    JSON.stringify({ schemaVersion: 2, manifests: options.extraManifest ? [descriptor, descriptor] : [descriptor] }),
  )
  if (options.extraBlob) put("stowaway")
  if (options.corrupt) writeFileSync(join(blobs, layer.digest.slice(7)), "tampered")
  if (options.link) symlinkSync("/etc/passwd", join(directory, "blobs/link"))
  if (options.outside) writeFileSync(join(directory, "extra.txt"), "x")
  const tarball = join(scratch, `case-${counter}.tar`)
  const archived = spawnSync("tar", ["-cf", tarball, "-C", directory, "."])
  expect(archived.status).toBe(0)
  return { tarball, digest: manifest.digest }
}

const check = (options: Options = {}, overrides: { digest?: string; version?: string; commit?: string } = {}) => {
  const { tarball, digest } = build(options)
  return () =>
    verify(
      tarball,
      {
        digest: overrides.digest ?? digest,
        version: overrides.version ?? "1.0.2-rc.1",
        commit: overrides.commit ?? commit,
        terraform: ecs,
      },
      join(scratch, `extract-${counter}`),
    )
}

describe("release OCI archive verification", () => {
  test("accepts a consistent archive and reports its digests", () => {
    const facts = check()()
    expect(facts.command).toEqual(["node", "/app/bymorning.mjs"])
    expect(facts.revision).toBe(revision)
  })

  test.each([
    ["a digest that is not the released one", {}, { digest: `sha256:${"a".repeat(64)}` }, /not the released/],
    ["a version label that differs", { version: "1.0.1" }, {}, /version label/],
    ["a revision from another commit", { revision: `ffffffffffff${"0".repeat(28)}` }, {}, /revision label/],
    ["more than one manifest", { extraManifest: true }, {}, /exactly 1/],
    ["a corrupted layer", { corrupt: true }, {}, /size differs|does not match its digest/],
    ["an unreferenced blob", { extraBlob: true }, {}, /unreferenced blob/],
    ["a non-amd64 image", { platform: "arm64" }, {}, /linux\/amd64/],
    ["a root user", { user: "0:0" }, {}, /image user/],
    ["a changed command", { cmd: ["node", "/app/other.mjs"] }, {}, /Cmd/],
    ["a symlink member", { link: true }, {}, /unexpected archive member|not a regular file/],
    ["a member outside the OCI layout", { outside: true }, {}, /unexpected archive member/],
  ] as const)("rejects %s", (_name, options, overrides, message) => {
    expect(check(options as Options, overrides)).toThrow(message)
  })

  test("rejects a Terraform task definition that overrides the gateway command or changes migrate", () => {
    const { tarball, digest } = build()
    const expected = { digest, version: "1.0.2-rc.1", commit }
    const drifted = join(scratch, "drifted.tf")
    writeFileSync(
      drifted,
      `{ name = "migrate"\n command = ["node", "/app/bymorning.mjs", "migrate", "--fast"]\n}\n{ name = "gateway"\n healthCheck = {} }`,
    )
    expect(() => verify(tarball, { ...expected, terraform: drifted }, join(scratch, "extract-drift-1"))).toThrow(
      /migrate command/,
    )
    const overridden = join(scratch, "overridden.tf")
    writeFileSync(
      overridden,
      `{ name = "migrate"\n command = ["node", "/app/bymorning.mjs", "migrate"]\n}\n{ name = "gateway"\n command = ["sh"]\n healthCheck = {} }`,
    )
    expect(() => verify(tarball, { ...expected, terraform: overridden }, join(scratch, "extract-drift-2"))).toThrow(
      /overrides the image command/,
    )
  })
})
