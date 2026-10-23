#!/usr/bin/env bun

// Builds the host bundle: the entrypoint (split so the migrate path never
// evaluates the serving composition), the web UI and migrations (embedded),
// the plugin runtime table (@bymorning/plugin/host-runtime replaced with the
// bundle's own effect, @bymorning/plugin, and @bymorning/schema instances, which
// @bymorning/plugin/host serves to Project plugins),
// the host's plugins under node_modules/, and its installation documents next
// to the bundle.
//
//   bun run script/build.mjs --entry <path> [--dev] [--outdir <path>]
//
// --entry accepts any entrypoint in the repository; the owning package (the
// nearest package.json above the entrypoint) is the host. The production build
// packages every @bymorning/plugin-* in the host's dependencies and every
// bymorning*.jsonc beside its package.json except the development document.
// --dev additionally packages the plugins in devDependencies, the development
// document (bymorning.docker.jsonc), and the PGlite runtime files. Flags accept
// both "--flag value" and "--flag=value".

import { $ } from "bun"
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { existsSync, statSync } from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { brotliCompressSync, constants } from "node:zlib"

const server = path.resolve(import.meta.dirname, "..")
const root = path.resolve(server, "../..")
const require = createRequire(path.join(server, "package.json"))
const web = path.join(root, "packages/web")

const args = process.argv.slice(2)
const option = (name) => {
  const inline = args.find((argument) => argument.startsWith(`--${name}=`))
  if (inline) return inline.slice(`--${name}=`.length)
  const index = args.indexOf(`--${name}`)
  return index === -1 ? undefined : args[index + 1]
}
const fail = (message) => {
  console.error(`error: ${message}`)
  process.exit(1)
}

const development = args.includes("--dev")
const entryArgument = option("entry")
if (!entryArgument) fail("pass --entry <path>, for example --entry app/host/src/index.ts")
const entry = path.resolve(root, entryArgument)
if (!statSync(entry, { throwIfNoEntry: false })?.isFile()) fail(`entrypoint not found: ${entryArgument}`)
const host = findHost(path.dirname(entry))
if (!host) fail(`no package.json found above entrypoint ${entryArgument}`)
const manifest = await Bun.file(path.join(host, "package.json")).json()

const outdir = path.resolve(server, option("outdir") ?? "dist")
const bundle = path.join(outdir, "bymorning.mjs")

// The development document never enters the production bundle.
const developmentDocument = "bymorning.docker.jsonc"
const plugins = [
  ...Object.keys(manifest.dependencies ?? {}),
  ...(development ? Object.keys(manifest.devDependencies ?? {}) : []),
].filter((name) => name.startsWith("@bymorning/plugin-"))
const documents = (await readdir(host))
  .filter((file) => /^bymorning(?:\..+)?\.jsonc$/.test(file))
  .filter((file) => development || file !== developmentDocument)
  .toSorted((a, b) => (a === "bymorning.jsonc" ? -1 : b === "bymorning.jsonc" ? 1 : a < b ? -1 : 1))

await $`bun run build`.cwd(web).env({ ...process.env, VITE_GATEWAY_URL: "" })

const webArchive = await archive(path.join(web, "dist"), (file) => !file.endsWith(".map"))
const migrationArchive = await archive(path.join(root, "packages/core/src/database/migration"), (file) =>
  file.endsWith("/migration.sql"),
)
const hostRuntime = path.join(root, "packages/plugin/src/host-runtime.ts")
const pluginRuntime = await runtimeTable()
const assetsPlugin = {
  name: "bymorning-assets",
  setup(build) {
    // jsonc-parser's UMD entry hides relative requires inside its factory function.
    build.onResolve({ filter: /^jsonc-parser$/ }, () => ({
      path: require.resolve("jsonc-parser/lib/esm/main.js"),
    }))
    build.onResolve({ filter: /^virtual:bymorning-assets$/ }, () => ({
      path: "bymorning-assets",
      namespace: "bymorning",
    }))
    build.onLoad({ filter: /^bymorning-assets$/, namespace: "bymorning" }, () => ({
      loader: "js",
      contents: `export default ${JSON.stringify({ web: webArchive, migrations: migrationArchive })}`,
    }))
    // Project plugins are materialized beneath a writable cache with no
    // node_modules ancestor; @bymorning/plugin/host serves these namespaces to
    // them. Static namespace imports keep them the bundle's own instances.
    build.onLoad({ filter: new RegExp(`^${escapeRegExp(hostRuntime)}$`) }, () => ({
      loader: "js",
      resolveDir: host,
      contents: pluginRuntime,
    }))
  },
}

await rm(outdir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })

const result = await Bun.build({
  entrypoints: [entry],
  tsconfig: path.join(server, "tsconfig.json"),
  plugins: [assetsPlugin],
  target: "node",
  format: "esm",
  minify: true,
  sourcemap: "none",
  define: { "import.meta.bundled": "true" },
  // Dynamic imports become sibling chunks, so `migrate` loads only the
  // migrator while `serve` loads the host composition and both cloud SDKs.
  splitting: true,
  outdir,
  naming: { entry: path.basename(bundle), chunk: "[name]-[hash].mjs" },
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

console.log(`built ${bundle}${development ? " (development)" : ""}`)

if (development) {
  // PGlite's WASM runtime loads these files next to import.meta.url.
  const pglite = path.dirname(
    createRequire(path.join(host, "package.json")).resolve("@electric-sql/pglite/package.json"),
  )
  for (const file of ["pglite.data", "pglite.wasm", "initdb.wasm"]) {
    await copyFile(path.join(pglite, "dist", file), path.join(outdir, file))
  }
}

// Ship the installation documents beside the bundle; BYMORNING_CONFIG selects
// one by absolute path at startup.
for (const file of documents) {
  await copyFile(path.join(host, file), path.join(outdir, file))
}

// Package every plugin the host offers so Config can load it at runtime,
// independently of which plugins an installation document enables.
const hostRequire = createRequire(path.join(host, "package.json"))
for (const name of plugins) {
  const directory = path.join(outdir, "node_modules", name)
  await mkdir(directory, { recursive: true })
  const plugin = await Bun.build({
    entrypoints: [hostRequire.resolve(`${name}/server`)],
    outdir: directory,
    naming: "index.js",
    target: "node",
    format: "esm",
    minify: true,
    plugins: [assetsPlugin],
  })
  if (!plugin.success) throw new AggregateError(plugin.logs, `Unable to package ${name}`)
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({
      name,
      type: "module",
      exports: { ".": "./index.js", "./server": "./index.js" },
    }),
  )
}

// The bare specifiers a Project plugin may import at runtime: effect, every
// runtime module of @bymorning/plugin by its exports map, and every
// @bymorning/schema module.
async function runtimeTable() {
  const modules = (directory) =>
    readdir(directory, { recursive: true, withFileTypes: true }).then((entries) =>
      entries
        .filter(
          (entry) => entry.isFile() && entry.name.endsWith(".ts") && !/\.(?:test|type-test|d)\.ts$/.test(entry.name),
        )
        .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)).replaceAll(path.sep, "/"))
        .toSorted(),
    )
  const plugin = (await modules(path.join(root, "packages/plugin/src")))
    .filter((file) => file !== "host.ts")
    .map((file) => {
      const subpath = file.slice(0, -".ts".length)
      if (subpath === "promise/index") return "@bymorning/plugin"
      if (subpath === "effect/index") return "@bymorning/plugin/effect"
      return `@bymorning/plugin/${subpath}`
    })
  const schema = (await modules(path.join(root, "packages/schema/src"))).map(
    (file) => `@bymorning/schema/${file.slice(0, -".ts".length)}`,
  )
  const specifiers = ["effect", ...plugin, ...schema]
  return [
    ...specifiers.map((specifier, index) => `import * as m${index} from ${JSON.stringify(specifier)}`),
    `export default new Map([${specifiers.map((specifier, index) => `[${JSON.stringify(specifier)}, m${index}]`).join(", ")}])`,
    "",
  ].join("\n")
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function findHost(directory) {
  let current = directory
  for (;;) {
    if (existsSync(path.join(current, "package.json"))) return current
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

async function archive(directory, include) {
  const files = (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)).replaceAll(path.sep, "/"))
    .filter(include)
    .toSorted()
  if (files.length === 0) throw new Error(`No files to embed from ${directory}`)
  const contents = Object.fromEntries(
    await Promise.all(
      files.map(async (file) => {
        const body = Buffer.from(await Bun.file(path.join(directory, file)).arrayBuffer())
        const encoding = /\.(?:css|html|js|json|md|sql|svg|txt)$/.test(file) ? "utf8" : "base64"
        return [file, { encoding, content: body.toString(encoding) }]
      }),
    ),
  )
  return brotliCompressSync(JSON.stringify(contents), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).toString("base64")
}
