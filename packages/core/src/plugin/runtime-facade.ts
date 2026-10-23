import type { Session as SessionSchema } from "@bymorning/schema/session"
import { Context, Effect, Layer } from "effect"
import { makeWorkspaceNode } from "@bymorning/util/effect/app-node"
import { Actor } from "../actor.js"
import type { Job } from "../job.js"
import type { Project } from "../project.js"
import type { ScheduledTask } from "../scheduled-task.js"
import type { Session } from "../session.js"
import type { SessionOperations } from "../session-operations.js"

/** Workspace Session operations exposed to trusted plugin code. */
export interface Interface {
  readonly session: Pick<
    Session.Interface & SessionOperations.Interface,
    | "get"
    | "messages"
    | "prompt"
    | "generate"
    | "command"
    | "rename"
    | "resume"
    | "switchAgent"
    | "switchModel"
    | "interrupt"
    | "synthetic"
    | "wait"
  > & {
    readonly create: (
      input: Parameters<Session.Interface["create"]>[0] | Parameters<Session.Interface["createChild"]>[0],
    ) => Effect.Effect<SessionSchema.Info, Project.NotFoundError | Project.ArchivedError | Session.NotFoundError>
  }
  readonly job: Pick<Job.Interface, "start" | "wait" | "block" | "background" | "cancel">
  readonly scheduledTask: Pick<ScheduledTask.Interface, "create" | "get" | "list" | "update" | "delete" | "run">
}

/** Workspace-scoped cycle-breaking Plugin runtime facade. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/PluginRuntime") {}

export interface Cell {
  runtime?: Interface
}

export const makeCell = (): Cell => ({})

/** Private member-lifetime cell backing the public stable runtime facade. */
export class CellService extends Context.Service<CellService, Cell>()("@bymorning/core/PluginRuntime.Cell") {}

export const cell = makeWorkspaceNode({
  service: CellService,
  layer: Layer.effect(
    CellService,
    Effect.map(Actor.Binding.Service, () => CellService.of(makeCell())),
  ),
  deps: [Actor.binding],
})

const requireRuntime = <A, E>(cell: Cell, use: (runtime: Interface) => Effect.Effect<A, E>) =>
  Effect.suspend(() => {
    if (cell.runtime === undefined) return Effect.die(new Error("Plugin runtime is unavailable"))
    return use(cell.runtime)
  })

/** Provide a stable facade whose calls resolve the currently installed Workspace runtime. */
export const layerWithCell = (cell: Cell) =>
  Layer.succeed(
    Service,
    Service.of({
      session: {
        get: (sessionID) => requireRuntime(cell, (runtime) => runtime.session.get(sessionID)),
        create: (input) => requireRuntime(cell, (runtime) => runtime.session.create(input)),
        messages: (input) => requireRuntime(cell, (runtime) => runtime.session.messages(input)),
        prompt: (input) => requireRuntime(cell, (runtime) => runtime.session.prompt(input)),
        generate: (input) => requireRuntime(cell, (runtime) => runtime.session.generate(input)),
        command: (input) => requireRuntime(cell, (runtime) => runtime.session.command(input)),
        rename: (input) => requireRuntime(cell, (runtime) => runtime.session.rename(input)),
        resume: (sessionID) => requireRuntime(cell, (runtime) => runtime.session.resume(sessionID)),
        switchAgent: (input) => requireRuntime(cell, (runtime) => runtime.session.switchAgent(input)),
        switchModel: (input) => requireRuntime(cell, (runtime) => runtime.session.switchModel(input)),
        interrupt: (sessionID, reason) =>
          requireRuntime(cell, (runtime) => runtime.session.interrupt(sessionID, reason)),
        synthetic: (input) => requireRuntime(cell, (runtime) => runtime.session.synthetic(input)),
        wait: (sessionID) => requireRuntime(cell, (runtime) => runtime.session.wait(sessionID)),
      },
      job: {
        start: (input) => requireRuntime(cell, (runtime) => runtime.job.start(input)),
        wait: (input) => requireRuntime(cell, (runtime) => runtime.job.wait(input)),
        block: (input) => requireRuntime(cell, (runtime) => runtime.job.block(input)),
        background: (id) => requireRuntime(cell, (runtime) => runtime.job.background(id)),
        cancel: (id) => requireRuntime(cell, (runtime) => runtime.job.cancel(id)),
      },
      scheduledTask: {
        create: (input) => requireRuntime(cell, (runtime) => runtime.scheduledTask.create(input)),
        get: (taskID) => requireRuntime(cell, (runtime) => runtime.scheduledTask.get(taskID)),
        list: requireRuntime(cell, (runtime) => runtime.scheduledTask.list),
        update: (input) => requireRuntime(cell, (runtime) => runtime.scheduledTask.update(input)),
        delete: (taskID) => requireRuntime(cell, (runtime) => runtime.scheduledTask.delete(taskID)),
        run: (taskID) => requireRuntime(cell, (runtime) => runtime.scheduledTask.run(taskID)),
      },
    }),
  )

/** Canonical stable cycle-breaking facade for one member graph. */
export const node = makeWorkspaceNode({
  service: Service,
  layer: Layer.unwrap(Effect.map(CellService, layerWithCell)),
  deps: [cell],
})
