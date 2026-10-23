/// <reference types="node" />

import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const root = dirname(fileURLToPath(import.meta.url))

describe("Tool UI import boundary", () => {
  it("keeps routing, clients, and page contexts outside Tool components", () => {
    const violations = readdirSync(root)
      .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx"))
      .flatMap((name) =>
        [...readFileSync(join(root, name), "utf8").matchAll(/\bfrom\s*["']([^"']+)["']/g)]
          .map((match) => match[1]!)
          .filter(
            (specifier) =>
              specifier === "@solidjs/router" ||
              specifier.startsWith("@bymorning/client") ||
              /^\.\.\/\.\.\/\.\.\/\.\.\/context(?:\/|$)/.test(specifier) ||
              /(?:^|\/)pages(?:\/|$)/.test(specifier),
          )
          .map((specifier) => `${relative(root, join(root, name))}: ${specifier}`),
      )

    expect(violations).toEqual([])
  })
})
