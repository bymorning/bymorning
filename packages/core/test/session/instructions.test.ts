import { describe, expect, it } from "vitest"
import { ProjectDirectory } from "../../src/project-directory.js"
import { SessionInstructions } from "../../src/session/instructions.js"

describe("SessionInstructions.candidates", () => {
  it("returns nearest ancestors and excludes the Project root", () => {
    expect(SessionInstructions.candidates(ProjectDirectory.Path.make("src/a/b.ts"))).toEqual([
      "src/a/AGENTS.md",
      "src/AGENTS.md",
    ])
  })

  it("returns no candidate for a root-level file", () => {
    expect(SessionInstructions.candidates(ProjectDirectory.Path.make("index.ts"))).toEqual([])
  })
})
