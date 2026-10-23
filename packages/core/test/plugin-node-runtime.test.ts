/**
 * Project plugins under Node itself. The deployed image materializes Project
 * plugins beneath os.tmpdir(), where no node_modules ancestor provides `effect`
 * or `@bymorning/plugin`; this suite drives test/fixture/plugin-node-runtime.ts
 * in a plain Node child process (tsx only for repository sources) so Node's
 * own resolution, not Vite's, decides whether a plugin loads.
 */
import { describe, expect, it } from "vitest"
import { execFile } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const script = fileURLToPath(new URL("./fixture/plugin-node-runtime.ts", import.meta.url))

const run = async (mode: "load" | "activate" | "table") => {
  const root = await mkdtemp(path.join(tmpdir(), "bm-plugin-node-runtime-"))
  try {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", script, mode, path.join(root, "plugins", "materialized")],
      { cwd: path.resolve(script, "../../.."), timeout: 60_000, maxBuffer: 1024 * 1024 },
    )
    return JSON.parse(stdout.trim().split("\n").at(-1)!) as Record<string, unknown>
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe("Project plugins under Node", () => {
  it("cannot import the plugin contract from a cache outside any node_modules without the host", async () => {
    const result = await run("load")
    expect(result).toMatchObject({ loaded: false, code: "ERR_MODULE_NOT_FOUND" })
    expect(result.message).toMatch(/^Cannot find package '@bymorning\/plugin' imported from /)
  }, 60_000)

  it("activates the probe plugin through the real source, materializer, and supervisor", async () => {
    const result = await run("activate")
    expect(result.inventory).toEqual([
      expect.objectContaining({
        id: "project.example",
        status: "active",
        source: expect.objectContaining({ path: "plugin/probe.ts" }),
      }),
    ])
    // The plugin's `effect` is the very instance the host runs.
    expect(result.journal).toBe("same:anchor")
  }, 60_000)

  it("serves the exposed module table the way the application bundle does", async () => {
    const result = await run("table")
    expect(result.inventory).toEqual([expect.objectContaining({ id: "project.example", status: "active" })])
    expect(result.journal).toBe("same:table")
  }, 60_000)
})
