import { describe, expect, it } from "vitest"
import { Agent } from "@bymorning/schema/agent"
import { ID as MessageID } from "@bymorning/schema/message"
import { Project } from "@bymorning/schema/project"
import { Session } from "@bymorning/schema/session"
import { Effect, Stream } from "effect"
import { EditTool } from "../src/plugin/internal/tool/edit.js"
import { activationNote, isEntrypoint } from "../src/plugin/internal/tool/plugin-entrypoint.js"
import { WriteTool } from "../src/plugin/internal/tool/write.js"
import { ProjectDirectory } from "../src/project-directory.js"
import { Tool } from "../src/tool.js"

const projectID = Project.ID.make("prj_00000000000000000000000931")

const context = (): Tool.Context => ({
  caller: {
    type: "session",
    sessionID: Session.ID.make("00000000-0000-4000-8000-000000000931"),
    messageID: MessageID.make("00000000-0000-4000-8000-000000000932"),
    agent: Agent.ID.make("build"),
    projectID,
  },
  id: Tool.CallID.make("call"),
  progress: () => Effect.void,
  elicit: () => Effect.die("unused"),
  permission: () => Effect.void,
})

/** In-memory Project Directory: the Tools under test only need write and read. */
const directory = (files: Map<string, string>): ProjectDirectory.Interface => ({
  projectID,
  list: Effect.sync(() => [...files.keys()].map((path) => ProjectDirectory.Path.make(path))),
  read: (path) => {
    const content = files.get(path)
    if (content === undefined) return Effect.fail(new ProjectDirectory.NotFoundError({ path }))
    return Effect.succeed({ content: Stream.succeed(new TextEncoder().encode(content)) })
  },
  write: (path, file) =>
    Stream.mkUint8Array(file.content).pipe(
      Effect.orDie,
      Effect.map((body) => {
        files.set(path, new TextDecoder().decode(body))
      }),
    ),
  delete: () => Effect.die("unused"),
  move: () => Effect.die("unused"),
})

describe("Project plugin entrypoint feedback", () => {
  it("recognizes exactly plugin/<slug>.ts and plugin/<slug>/index.ts", () => {
    expect(isEntrypoint("plugin/probe.ts")).toBe(true)
    expect(isEntrypoint("plugin/gmail/index.ts")).toBe(true)
    expect(isEntrypoint("plugin/gmail/helper.ts")).toBe(false)
    expect(isEntrypoint("plugin/nested/deep.ts")).toBe(false)
    expect(isEntrypoint("plugin/notes.md")).toBe(false)
    expect(isEntrypoint("plugins/probe.ts")).toBe(false)
    expect(isEntrypoint("src/plugin/probe.ts")).toBe(false)
  })

  it("tells the model to verify activation after writing or editing an entrypoint, and stays silent otherwise", () => {
    const files = new Map<string, string>()
    return Effect.gen(function* () {
      const written = yield* WriteTool.execute(
        { path: "plugin/probe.ts", content: "export default 1" },
        context(),
      )
      expect(written.output).toBe(`Wrote Project File: @plugin/probe.ts ${activationNote}`)
      expect(written.output).toContain("toolkit.plugin.list")
      expect(written.output).toContain('status: "active"')

      const notes = yield* WriteTool.execute({ path: "notes.txt", content: "hello" }, context())
      expect(notes.output).toBe("Wrote Project File: @notes.txt")

      const helper = yield* WriteTool.execute({ path: "plugin/probe/helper.ts", content: "export const x = 1" }, context())
      expect(helper.output).toBe("Wrote Project File: @plugin/probe/helper.ts")

      const edited = yield* EditTool.execute(
        { path: "plugin/probe.ts", oldString: "1", newString: "2" },
        context(),
      )
      expect(edited.content).toEqual([
        { type: "text", text: `Edited Project File: @plugin/probe.ts (1 replacement) ${activationNote}` },
      ])
      expect(files.get("plugin/probe.ts")).toBe("export default 2")

      const editedNotes = yield* EditTool.execute({ path: "notes.txt", oldString: "hello", newString: "bye" }, context())
      expect(editedNotes.content).toEqual([{ type: "text", text: "Edited Project File: @notes.txt (1 replacement)" }])
    }).pipe(Effect.provideService(ProjectDirectory.Service, directory(files)), Effect.runPromise)
  })
})
