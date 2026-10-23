import { describe, expect, it } from "@effect/vitest"
import { Agent as AgentSchema } from "@bymorning/schema/agent"
import { ID as MessageID } from "@bymorning/schema/message"
import { Project } from "@bymorning/schema/project"
import { Session } from "@bymorning/schema/session"
import { Tool } from "@bymorning/schema/tool"
import { Effect, Ref } from "effect"
import { SidebarTool } from "../src/plugin/internal/tool/sidebar.js"
import { ProjectDirectory } from "../src/project-directory.js"

const projectID = Project.ID.make("prj_00000000000000000000000101")

const caller = {
  type: "session" as const,
  sessionID: Session.ID.make("00000000-0000-4000-8000-000000000101"),
  agent: AgentSchema.ID.make("default"),
  messageID: MessageID.make("00000000-0000-4000-8000-000000000102"),
  projectID,
}

const make = (permissions: Ref.Ref<ReadonlyArray<unknown>>): Tool.Context => ({
  caller,
  id: Tool.CallID.make("call_sidebar"),
  progress: () => Effect.void,
  elicit: () => Effect.die("unused"),
  permission: (request: unknown) => Ref.update(permissions, (items) => [...items, request]),
})

const directory = (paths: ReadonlyArray<string>) =>
  ProjectDirectory.Service.of({
    projectID,
    list: Effect.succeed(paths.map((path) => ProjectDirectory.Path.make(path))),
    read: () => Effect.die("unused"),
    write: () => Effect.die("unused"),
    delete: () => Effect.die("unused"),
    move: () => Effect.die("unused"),
  })

const run = <A, E>(effect: Effect.Effect<A, E, ProjectDirectory.Service>, paths: ReadonlyArray<string>) =>
  Effect.provideService(effect, ProjectDirectory.Service, directory(paths))

describe("sidebar tool", () => {
  it.effect("opens the Right Sidebar on an existing Project File", () =>
    Effect.gen(function* () {
      const permissions = yield* Ref.make<ReadonlyArray<unknown>>([])
      const result = yield* run(
        SidebarTool.execute({ open: true, path: "dashboards/status.html" }, make(permissions)),
        ["dashboards/status.html", "data/tasks.csv"],
      )
      expect(result.output).toEqual({ open: true, path: "dashboards/status.html" })
      expect(result.content).toEqual([{ type: "text", text: "Showing @dashboards/status.html in the Right Sidebar" }])
      const resource = ProjectDirectory.resource(projectID, ProjectDirectory.Path.make("dashboards/status.html"))
      expect(yield* Ref.get(permissions)).toEqual([
        expect.objectContaining({ action: "sidebar", resources: [resource], save: [resource] }),
      ])
    }),
  )

  it.effect("closes without naming a file", () =>
    Effect.gen(function* () {
      const permissions = yield* Ref.make<ReadonlyArray<unknown>>([])
      const result = yield* run(SidebarTool.execute({ open: false }, make(permissions)), [])
      expect(result.output).toEqual({ open: false })
      expect(yield* Ref.get(permissions)).toEqual([expect.objectContaining({ action: "sidebar", resources: ["*"] })])
    }),
  )

  it.effect("opens without naming a file", () =>
    Effect.gen(function* () {
      const permissions = yield* Ref.make<ReadonlyArray<unknown>>([])
      const result = yield* run(SidebarTool.execute({ open: true }, make(permissions)), [])
      expect(result.output).toEqual({ open: true })
      expect(result.content).toEqual([{ type: "text", text: "Opened the Right Sidebar" }])
      expect(yield* Ref.get(permissions)).toEqual([expect.objectContaining({ action: "sidebar", resources: ["*"] })])
    }),
  )

  it.effect("reports a Project Directory read failure instead of a false not-found", () =>
    Effect.gen(function* () {
      const permissions = yield* Ref.make<ReadonlyArray<unknown>>([])
      const broken = ProjectDirectory.Service.of({
        projectID,
        list: Effect.fail(new ProjectDirectory.OperationError({ operation: "list", cause: "directory unavailable" })),
        read: () => Effect.die("unused"),
        write: () => Effect.die("unused"),
        delete: () => Effect.die("unused"),
        move: () => Effect.die("unused"),
      })
      const error = yield* Effect.flip(
        Effect.provideService(
          SidebarTool.execute({ open: true, path: "dashboards/status.html" }, make(permissions)),
          ProjectDirectory.Service,
          broken,
        ),
      )
      expect(error).toBeInstanceOf(Tool.Error)
      expect(error.message).toBe("Unable to read the Project Directory")
    }),
  )

  it.effect("ignores a path when closing, so a close never reopens on a file", () =>
    Effect.gen(function* () {
      const permissions = yield* Ref.make<ReadonlyArray<unknown>>([])
      const result = yield* run(SidebarTool.execute({ open: false, path: "dashboards/status.html" }, make(permissions)), [
        "dashboards/status.html",
      ])
      expect(result.output).toEqual({ open: false })
    }),
  )

  it.effect("refuses a Project File that does not exist", () =>
    Effect.gen(function* () {
      const permissions = yield* Ref.make<ReadonlyArray<unknown>>([])
      const error = yield* Effect.flip(
        run(SidebarTool.execute({ open: true, path: "dashboards/missing.html" }, make(permissions)), [
          "dashboards/status.html",
        ]),
      )
      expect(error).toBeInstanceOf(Tool.Error)
      expect(error.message).toBe("Project File not found: dashboards/missing.html")
    }),
  )

  it.effect("refuses a path that escapes the Project Directory", () =>
    Effect.gen(function* () {
      const permissions = yield* Ref.make<ReadonlyArray<unknown>>([])
      const error = yield* Effect.flip(
        run(SidebarTool.execute({ open: true, path: "../secrets.env" }, make(permissions)), ["dashboards/status.html"]),
      )
      expect(error).toBeInstanceOf(Tool.Error)
      expect(error.message).toBe("Invalid Project File path: ../secrets.env")
      // The path never resolves, so no Permission is asserted against a resource that cannot exist.
      expect(yield* Ref.get(permissions)).toEqual([])
    }),
  )
})
