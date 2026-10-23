import { describe, expect, test } from "vitest"
import { CodeModeCatalog } from "../../src/codemode/catalog.js"

const entry = (path: string, description: string, signature?: string, pinned = false) => ({
  type: "tool" as const,
  name: path,
  description,
  signature: signature ?? `tools.${path}(): Promise<void>`,
  pinned,
})

describe("CodeModeCatalog", () => {
  test("always retains pinned tools beyond the inline budget", () => {
    const pinned = [entry("alpha.first", "First", undefined, true), entry("beta.second", "Second", undefined, true)]
    const catalog = CodeModeCatalog.summarize(
      { tools: [...pinned, entry("alpha.unpinned", "Unpinned")] },
      { budget: 0 },
    )

    expect(catalog.shown).toBe(2)
    expect(catalog.namespaces.flatMap((namespace) => namespace.entries.map(({ path }) => path))).toEqual([
      "alpha.first",
      "beta.second",
    ])
  })

  test("advertises search when the inline budget omits tools", () => {
    const rendered = CodeModeCatalog.render({
      tools: Array.from({ length: 300 }, (_, index) => entry(`large.operation_${index}`, "x".repeat(120))),
    })

    expect(rendered).toContain("catalog below is partial")
    expect(rendered).toContain("Use `search` to discover exact paths and signatures")
    expect(rendered).toContain("query?: string")
  })
})
