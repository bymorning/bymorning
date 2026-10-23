import { describe, expect, it } from "vitest"
import { Agent } from "@bymorning/schema/agent"
import { ID as MessageID } from "@bymorning/schema/message"
import { Project as ProjectSchema } from "@bymorning/schema/project"
import { ScheduledTask as ScheduledTaskSchema } from "@bymorning/schema/scheduled-task"
import { Session } from "@bymorning/schema/session"
import { Effect } from "effect"
import { Project } from "../src/project.js"
import type { PluginRuntime } from "../src/plugin/runtime.js"
import { registerScheduleTools } from "../src/plugin/internal/tool/toolkit-schedule.js"
import { Tool } from "../src/tool.js"

const context = (): Tool.Context => ({
  caller: {
    type: "session",
    sessionID: Session.ID.make("00000000-0000-4000-8000-000000000901"),
    messageID: MessageID.make("00000000-0000-4000-8000-000000000902"),
    agent: Agent.ID.make("build"),
    projectID: ProjectSchema.ID.make("prj_00000000000000000000000921"),
  },
  id: Tool.CallID.make("call"),
  progress: () => Effect.void,
  elicit: () => Effect.die("unused"),
  permission: () => Effect.void,
})

const task = ScheduledTaskSchema.Info.make({
  id: ScheduledTaskSchema.ID.make("tsk_00000000000000000000000921"),
  name: "Daily briefing",
  prompt: "Summarize the day",
  cron: "0 8 * * 1-5",
  timezone: "UTC",
  projectID: ProjectSchema.ID.make("prj_00000000000000000000000921"),
  enabled: true,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
})

const die = () => Effect.die(new Error("unused in this test"))

/** Registers `registerScheduleTools` against a stub runtime and returns its `execute` handlers by name. */
const register = (overrides: Partial<PluginRuntime.Interface["scheduledTask"]>) => {
  const runtime: PluginRuntime.Interface["scheduledTask"] = {
    create: die,
    get: die,
    list: die(),
    update: die,
    delete: die,
    run: die,
    ...overrides,
  }
  const added: Tool.Registration[] = []
  registerScheduleTools(
    {
      list: () => [],
      get: () => undefined,
      namespace: () => undefined,
      update: () => undefined,
      remove: () => undefined,
      add: (tool) => added.push(tool),
    },
    runtime,
  )
  const byName = new Map(added.map((tool) => [tool.name, tool]))
  return {
    execute: (name: string, input: unknown) => {
      const tool = byName.get(name)
      if (tool?.execute === undefined) throw new Error(`Scheduled Task tool missing: ${name}`)
      return tool.execute(input, context())
    },
  }
}

describe("toolkit.schedule", () => {
  it("lists and gets a task", () =>
    Effect.gen(function* () {
      const tools = register({ list: Effect.succeed([task]), get: () => Effect.succeed(task) })
      expect(yield* tools.execute("list", {})).toMatchObject({ output: { tasks: [{ name: "Daily briefing" }] } })
      expect(yield* tools.execute("get", { taskID: task.id })).toMatchObject({ output: { name: "Daily briefing" } })
    }).pipe(Effect.runPromise))

  it("maps ScheduledTask.NotFoundError to a Tool.Error on get, update, delete, and run", () =>
    Effect.gen(function* () {
      const tools = register({
        get: () => new ScheduledTaskSchema.NotFoundError({ taskID: task.id }),
        update: () => new ScheduledTaskSchema.NotFoundError({ taskID: task.id }),
        delete: () => new ScheduledTaskSchema.NotFoundError({ taskID: task.id }),
        run: () => new ScheduledTaskSchema.NotFoundError({ taskID: task.id }),
      })
      for (const [name, input] of [
        ["get", { taskID: task.id }],
        ["update", { taskID: task.id, enabled: false }],
        ["delete", { taskID: task.id }],
        ["run", { taskID: task.id }],
      ] as const) {
        const failure = yield* tools.execute(name, input).pipe(Effect.flip)
        expect(failure).toBeInstanceOf(Tool.Error)
        expect((failure as Tool.Error).message).toBe("Scheduled Task not found")
      }
    }).pipe(Effect.runPromise))

  it("maps ScheduledTask.LimitError to an actionable Tool.Error on create", () =>
    Effect.gen(function* () {
      const tools = register({ create: () => new ScheduledTaskSchema.LimitError({ limit: 20 }) })
      const failure = yield* tools
        .execute("create", { name: "x", prompt: "y", cron: "0 8 * * *", timezone: "UTC" })
        .pipe(Effect.flip)
      expect((failure as Tool.Error).message).toBe(
        "The user already has the maximum of 20 Scheduled Tasks; delete one first",
      )
    }).pipe(Effect.runPromise))

  it("maps ScheduledTask.ScheduleError to its message on create and update", () =>
    Effect.gen(function* () {
      const message = "Schedule occurrences must be at least one hour apart"
      const tools = register({
        create: () => new ScheduledTaskSchema.ScheduleError({ message }),
        update: () => new ScheduledTaskSchema.ScheduleError({ message }),
      })
      for (const [name, input] of [
        ["create", { name: "x", prompt: "y", cron: "*/5 * * * *", timezone: "UTC" }],
        ["update", { taskID: task.id, cron: "*/5 * * * *" }],
      ] as const) {
        const failure = yield* tools.execute(name, input).pipe(Effect.flip)
        expect((failure as Tool.Error).message).toBe(message)
      }
    }).pipe(Effect.runPromise))

  it("maps Project.NotFoundError to a Tool.Error on create and update", () =>
    Effect.gen(function* () {
      const tools = register({
        create: () => new Project.NotFoundError({ projectID: ProjectSchema.ID.make("prj_00000000000000000000000922") }),
        update: () => new Project.NotFoundError({ projectID: ProjectSchema.ID.make("prj_00000000000000000000000922") }),
      })
      for (const [name, input] of [
        ["create", { name: "x", prompt: "y", cron: "0 8 * * *", timezone: "UTC" }],
        ["update", { taskID: task.id, projectID: ProjectSchema.ID.make("prj_00000000000000000000000922") }],
      ] as const) {
        const failure = yield* tools.execute(name, input).pipe(Effect.flip)
        expect((failure as Tool.Error).message).toBe("Project not found")
      }
    }).pipe(Effect.runPromise))

  it("maps ScheduledTask.RunError to its message on run", () =>
    Effect.gen(function* () {
      const tools = register({
        run: () => new ScheduledTaskSchema.RunError({ taskID: task.id, message: "The task's Project no longer exists" }),
      })
      const failure = yield* tools.execute("run", { taskID: task.id }).pipe(Effect.flip)
      expect((failure as Tool.Error).message).toBe("The task's Project no longer exists")
    }).pipe(Effect.runPromise))

  it("deletes a task and reports the deleted ID", () =>
    Effect.gen(function* () {
      const tools = register({ delete: () => Effect.void })
      expect(yield* tools.execute("delete", { taskID: task.id })).toMatchObject({ output: { deleted: task.id } })
    }).pipe(Effect.runPromise))
})
