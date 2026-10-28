import { describe, expect, test } from "vitest"

import { skillLibrary } from "./catalog"
import { skillLibraryCategories } from "./model"

/** Real Tool names an entry may direct the model to. */
const tools = [
  "read",
  "write",
  "edit",
  "glob",
  "grep",
  "shell",
  "run",
  "skill",
  "sidebar",
  "webfetch",
  "websearch",
  "question",
  "subagent",
  "tool_output",
  "add",
]

/**
 * Tool names from other assistant products. An entry naming one of these was
 * written against the wrong harness and would send the model after a Tool
 * that does not exist here.
 */
const foreign = [
  "bash",
  "view",
  "str_replace",
  "create_file",
  "artifacts",
  "repl",
  "computer",
  "text_editor",
  "code_interpreter",
  "file_search",
  "browser",
]

describe("Skill library catalog", () => {
  test("every entry has a decodable kebab-case ID within the size limit", () => {
    for (const entry of skillLibrary) {
      expect(entry.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(entry.id.length).toBeLessThanOrEqual(30)
    }
  })

  test("entry IDs and names are unique", () => {
    expect(new Set(skillLibrary.map((entry) => entry.id)).size).toBe(skillLibrary.length)
    expect(new Set(skillLibrary.map((entry) => entry.name)).size).toBe(skillLibrary.length)
  })

  test("every entry belongs to a real category", () => {
    const categories = new Set(skillLibraryCategories.map((category) => category.id))
    for (const entry of skillLibrary) expect(categories.has(entry.category), entry.id).toBe(true)
  })

  test("every entry directs the model to at least one real Tool", () => {
    for (const entry of skillLibrary) {
      const named = tools.filter((tool) => entry.instructions.includes(`\`${tool}\``))
      expect(named, `${entry.id} names no Tool`).not.toHaveLength(0)
    }
  })

  test("no entry names a Tool from another assistant product", () => {
    for (const entry of skillLibrary) {
      for (const name of foreign) {
        expect(entry.instructions, `${entry.id} names ${name}`).not.toContain(`\`${name}\``)
      }
    }
  })
})
