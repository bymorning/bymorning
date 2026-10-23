import { describe, expect, it } from "vitest"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "../../..")
const allowed = [
  "build/",
  "release/",
  "plugins/google/",
  "packages/core/test/google-gmail-plugin.test.ts",
  "packages/core/test/provider-dehardcoding.test.ts",
  "packages/models/source/models-dev/cache/",
  "THIRD_PARTY_NOTICES.md",
]
const allowedProviderEnvironmentNames = new Set([
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GEMINI_API_KEY",
  // The Gemini CLI reads its gateway origin from this name; it is not a credential.
  "GOOGLE_GEMINI_BASE_URL",
  "OPENCODE_API_KEY",
])

describe("provider de-hardcoding", () => {
  it("keeps Gmail credentials out of deployment and environment registration outside its plugin package", async () => {
    const violations: string[] = []
    for (const file of await sourceFiles(root)) {
      const relative = path.relative(root, file)
      if (allowed.some((prefix) => relative.startsWith(prefix))) continue
      const environmentNames =
        (await readFile(file, "utf8")).match(/\b(?:GOOGLE_[A-Z0-9_]+|GEMINI_API_KEY|OPENCODE_API_KEY)\b/gi) ?? []
      if (environmentNames.some((name) => !allowedProviderEnvironmentNames.has(name.toUpperCase())))
        violations.push(relative)
    }
    expect(violations).toEqual([])
  })
})

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      entry.name === ".git" ||
      entry.name === ".sst" ||
      entry.name === "node_modules" ||
      entry.name === ".bymorning" ||
      entry.name === "dist"
    )
      continue
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await sourceFiles(target)))
    else if (/\.(?:ts|tsx|js|json|md|sql)$/.test(entry.name)) files.push(target)
  }
  return files
}
