/// <reference types="node" />

import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const root = dirname(fileURLToPath(import.meta.url))
const files = walk(root).filter((path) => /\.(?:css|tsx?)$/.test(path))
// Application contexts are prohibited; the UI layer's own contexts (ui/context/i18n) are presentation.
const prohibited = [/^@bymorning\//, /(?:^|\/)(?<!ui\/)context\//, /(?:^|\/)pages\//]

describe("Session list import boundary", () => {
  it("does not depend on generated types or page and application contexts", () => {
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
