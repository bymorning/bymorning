/// <reference types="node" />

import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const root = dirname(fileURLToPath(import.meta.url))
const files = walk(root).filter((path) => /\.tsx?$/.test(path))
const prohibited = [
  /^@bymorning\/(?:client|schema)(?:\/|$)/,
  /(?:^|\/)context\/(?:sdk|workspace|settings)(?:\.[^/]*)?$/,
  /(?:^|\/)(?:session-context|session-connection|model-option)(?:\.[^/]*)?$/,
]

describe("Session UI import boundary", () => {
  it("keeps generated and application connection types outside feature UI", () => {
    const violations = files.flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g)]
        .map((match) => match[1]!)
        .filter((specifier) => prohibited.some((pattern) => pattern.test(specifier)))
        .map((specifier) => `${relative(root, path)}: ${specifier}`),
    )
    expect(violations).toEqual([])
  })
})

function walk(directory: string): ReadonlyArray<string> {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}
