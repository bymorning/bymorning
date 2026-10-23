import { describe, expect, it } from "@effect/vitest"
import { Project } from "@bymorning/schema/project"
import { Session } from "@bymorning/schema/session"
import { Workspace } from "@bymorning/schema/workspace"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { InstructionBuiltIns } from "../src/instruction-builtins.js"
import { Instruction } from "../src/instruction.js"

const sessionID = Session.ID.make("00000000-0000-4000-8000-000000000001")
const workspaceID = Workspace.ID.make("wrk_instruction_builtins")
const projectID = Project.ID.make("prj_00000000000000000000000001")
const environment = [
  "<env>",
  `  Current conversation session ID: ${sessionID}`,
  `  Workspace ID: ${workspaceID}`,
  `  Project ID: ${projectID}`,
  "  Project files use a storage-backed, project-relative namespace.",
  "</env>",
].join("\n")

describe("InstructionBuiltIns", () => {
  it("loads environment, surface, and date sources in key order", () => {
    expect(InstructionBuiltIns.load({ sessionID, workspaceID, projectID }).map(({ key }) => key)).toEqual([
      "core/environment",
      "core/surface",
      "core/date",
    ])
  })

  it.effect("renders the environment with a project ID", () =>
    Effect.gen(function* () {
      const [source] = InstructionBuiltIns.load({ sessionID, workspaceID, projectID })
      expect(yield* source.read).toBe(environment)
      expect(source.initial(environment)).toBe(
        ["Here is some useful information about the environment you are running in:", environment].join("\n"),
      )
      expect(source.changed("previous", environment)).toBe(
        ["The environment you are running in is now:", environment].join("\n"),
      )
    }),
  )

  it.effect("omits the project line when no project is selected", () =>
    Effect.gen(function* () {
      const [source] = InstructionBuiltIns.load({ sessionID, workspaceID, projectID: undefined })
      expect(yield* source.read).toBe(
        [
          "<env>",
          `  Current conversation session ID: ${sessionID}`,
          `  Workspace ID: ${workspaceID}`,
          "  Project files use a storage-backed, project-relative namespace.",
          "</env>",
        ].join("\n"),
      )
    }),
  )

  it.effect("renders the application surface with the member's Role and real paths", () =>
    Effect.gen(function* () {
      const [, source] = InstructionBuiltIns.load({ sessionID, workspaceID, projectID, role: "member" })
      const app = yield* source.read
      expect(app).toMatch(/^<app>\n[\s\S]*\n<\/app>$/)
      expect(app).toContain("The member you are assisting has the member Role in this Workspace")
      expect(app).toContain("cannot open the Console or configure Integrations' OAuth clients")
      expect(app).toContain(`Integrations: a Console page at /w/${workspaceID}/mcp`)
      expect(app).toContain('"Connect integration" command in the command palette')
      expect(app).toContain("toolkit.integration.connect")
      expect(app).toContain("Main sidebar: Overview, Scheduled tasks.")
      expect(app).toContain(
        "Console (Workspace administrators only): Gateway (Overview, Leaderboard, Models, Routing, Integrations); Assistant (Agents, Skills); Workspace (Members, Service accounts, SSO, Audit log, Budgets); Installation (Installation, Installation Policy).",
      )
      expect(app).toContain(`/w/${workspaceID}/installation and /w/${workspaceID}/installation/policy, managed by Installation Admins`)
      expect(app).toContain('There is no "Settings" section anywhere in ByMorning.')
      expect(source.initial(app)).toBe(
        ["Here is how the ByMorning application you run inside is organized for this member:", app].join("\n"),
      )
      expect(source.changed("previous", app)).toBe(["The ByMorning application is now organized as:", app].join("\n"))

      const [, admin] = InstructionBuiltIns.load({ sessionID, workspaceID, projectID, role: "admin" })
      expect(yield* admin.read).toContain(
        "has the admin Role in this Workspace; they can open the Console and configure Integrations' OAuth clients.",
      )

      const [, system] = InstructionBuiltIns.load({ sessionID, workspaceID, projectID })
      const unbound = yield* system.read
      expect(unbound).not.toContain("Role in this Workspace")
      expect(unbound).toContain(`Integrations: a Console page at /w/${workspaceID}/mcp`)
    }),
  )

  it.effect("renders initial and changed dates", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.UTC(2026, 8, 3, 12))
      const [, , source] = InstructionBuiltIns.load({ sessionID, workspaceID, projectID })
      const date = yield* source.read
      expect(date).toBe("Thu Sep 03 2026")
      expect(source.initial(date)).toBe("Today's date: Thu Sep 03 2026")
      expect(source.changed("Wed Sep 02 2026", date)).toBe("Today's date is now: Thu Sep 03 2026")
    }),
  )

  it.effect("emits a delta when the date changes", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.UTC(2026, 8, 3, 12))
      const sources = InstructionBuiltIns.load({ sessionID, workspaceID, projectID })
      const initial = yield* Instruction.diff(yield* Instruction.read(sources))

      yield* TestClock.adjust("1 day")

      const update = yield* Instruction.diff(
        yield* Instruction.read(sources),
        Instruction.applyHashDelta({}, initial.delta),
      )
      expect(update.delta).toEqual({ "core/date": Instruction.hash("Fri Sep 04 2026") })
      expect(update.blobs).toEqual({ [Instruction.hash("Fri Sep 04 2026")]: "Fri Sep 04 2026" })
    }),
  )
})
