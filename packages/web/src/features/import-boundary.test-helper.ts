/// <reference types="node" />

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

// Features may only depend on ui/, utils/, runtime/ and workspace-route-paths.
const prohibited = [
  /^@bymorning\//,
  /(?:^|\/)(?:app|context|gateway|home|integration|login|mcp|members|new-session|not-found|oauth|project|prototypes|scheduled-task|session|shell)\//,
]

export function describeImportBoundary(name: string, root: string) {
  describe(name, () => {
    it("does not depend on generated types or page and application contexts", () => {
      const violations = walk(root)
        .filter((path) => /\.(?:css|tsx?)$/.test(path))
        .flatMap((path) =>
          [...readFileSync(path, "utf8").matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g)]
            .map((match) => match[1]!)
            .filter((specifier) => prohibited.some((pattern) => pattern.test(specifier)))
            .map((specifier) => `${relative(root, path)}: ${specifier}`),
        )
      expect(violations).toEqual([])
    })
  })
}

function walk(directory: string): ReadonlyArray<string> {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}
