import { describe, expect, it } from "vitest"
import { Agent } from "@bymorning/schema/agent"
import { ID as MessageID } from "@bymorning/schema/message"
import { Project } from "@bymorning/schema/project"
import { Session } from "@bymorning/schema/session"
import { Skill as SkillSchema } from "@bymorning/schema/skill"
import { Effect } from "effect"
import { Skill } from "../src/skill.js"
import { registerSkillTools } from "../src/plugin/internal/tool/toolkit-skill.js"
import { Tool } from "../src/tool.js"

const context = (): Tool.Context => ({
  caller: {
    type: "session",
    sessionID: Session.ID.make("00000000-0000-4000-8000-000000000901"),
    messageID: MessageID.make("00000000-0000-4000-8000-000000000902"),
    agent: Agent.ID.make("build"),
    projectID: Project.ID.make("prj_00000000000000000000000921"),
  },
  id: Tool.CallID.make("call"),
  progress: () => Effect.void,
  elicit: () => Effect.die("unused"),
  permission: () => Effect.void,
})

describe("toolkit.skill", () => {
  it("creates and lists a Skill", () =>
    Effect.gen(function* () {
      const skills: SkillSchema.Info[] = []
      const skill = Skill.Service.of({
        list: Effect.sync(() => skills),
        get: (skillID) => {
          const found = skills.find((item) => item.id === skillID)
          return found === undefined ? new Skill.NotFoundError({ skillID }) : Effect.succeed(found)
        },
        create: (input) =>
          Effect.sync(() => {
            const created = SkillSchema.Info.make({ ...input, id: SkillSchema.ID.create() })
            skills.push(created)
            return created
          }),
        update: () => Effect.die("unused"),
        delete: () => Effect.die("unused"),
        transform: () => Effect.die("unused"),
        reload: () => Effect.die("unused"),
      })
      const added: Tool.Registration[] = []
      registerSkillTools(
        {
          list: () => [],
          get: () => undefined,
          namespace: () => undefined,
          update: () => undefined,
          remove: () => undefined,
          add: (tool) => added.push(tool),
        },
        skill,
      )
      const create = added.find((tool) => tool.name === "create" && tool.execute !== undefined)
      const list = added.find((tool) => tool.name === "list" && tool.execute !== undefined)
      if (create?.execute === undefined || list?.execute === undefined) throw new Error("skill tools missing")
      const created = yield* create.execute(
        { name: "runbook", description: "Incident runbook", instructions: "Collect evidence first." },
        context(),
      )
      expect(created).toMatchObject({
        output: { name: "runbook", description: "Incident runbook" },
      })
      const listed = yield* list.execute({}, context())
      expect(listed).toMatchObject({ output: { skills: [{ name: "runbook" }] } })
    }).pipe(Effect.runPromise))
})
