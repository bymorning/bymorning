import { execFile } from "node:child_process"
import { readdir, readFile } from "node:fs/promises"
import { promisify } from "node:util"

const execute = promisify(execFile)
const roots = ["src/promise/generated", "src/effect/generated", "src/effect/api"]

const snapshot = async () => {
  const files = new Map<string, string>()
  const visit = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`
      if (entry.isDirectory()) await visit(path)
      else files.set(path, await readFile(path, "utf8"))
    }
  }
  for (const root of roots) await visit(root)
  return files
}

const before = await snapshot()
await execute(process.execPath, ["run", "script/build.ts"], { cwd: process.cwd() })
const after = await snapshot()
const changed = new Set([...before.keys(), ...after.keys()])
for (const path of changed) {
  if (before.get(path) !== after.get(path)) {
    console.error(`Generated output is stale: ${path}`)
    process.exitCode = 1
  }
}
