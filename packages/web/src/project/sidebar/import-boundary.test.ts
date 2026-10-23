/// <reference types="node" />

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const projectSource = readFileSync(join(process.cwd(), "src/project/sidebar/view.tsx"), "utf8")
const primitiveSource = readFileSync(join(process.cwd(), "src/ui/sidebar/sidebar.tsx"), "utf8")
const prohibited = [/^@bymorning\//, /@solidjs\/router/, /(?:^|\/)context\//, /(?:^|\/)shell\//, /(?:^|\/)controller/]

describe("Project sidebar view import boundary", () => {
  it("does not depend on application state, routing, or generated schemas", () => {
    const violations = [...projectSource.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g)]
      .map((match) => match[1]!)
      .filter((specifier) => prohibited.some((pattern) => pattern.test(specifier)))
    expect(violations).toEqual([])
  })

  it("keeps generic sidebar primitives independent of project code", () => {
    expect(primitiveSource).not.toMatch(/project-sidebar|(?:^|\/)project\//)
  })
})
