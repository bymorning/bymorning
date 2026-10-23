import { Effect, Layer, Option } from "effect"
import { makeWorkspaceNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"
import { Job } from "../job.js"
import { Session } from "../session.js"
import type { SessionOperations } from "../session-operations.js"
import type { ScheduledTask } from "../scheduled-task.js"
import { CellService, Service, cell, type Cell, type Interface } from "./runtime-facade.js"
export {
  CellService,
  Service,
  cell,
  layerWithCell,
  makeCell,
  node,
  type Cell,
  type Interface,
} from "./runtime-facade.js"

/** Install the exact Workspace Session identities until their owning Scope closes. */
export const providerLayerWithCell = (cell: Cell) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      // Deferred load breaks the module-init cycle
      // session-operations → plugin → runtime → session-operations, whose
      // eager deps arrays read partially-initialized `Session.node`,
      // `Plugin.node`, and `Usage.node`. Everything is initialized by the time
      // this layer is first built.
      const { SessionOperations } = yield* Effect.promise(() => import("../session-operations.js"))
      const operations = yield* SessionOperations.Service
      const jobs = yield* Job.Service
      // Same deferred load as above; Scheduled Task is optional so narrower test graphs still install the runtime.
      const { ScheduledTask } = yield* Effect.promise(() => import("../scheduled-task.js"))
      const scheduledTasks = yield* Effect.serviceOption(ScheduledTask.Service)
      const unavailable = Effect.die(new Error("Scheduled Task runtime is unavailable"))
      const runtime = {
        session: {
          get: sessions.get,
          create: (input) => ("parentID" in input ? sessions.createChild(input) : sessions.create(input)),
          messages: sessions.messages,
          prompt: sessions.prompt,
          generate: operations.generate,
          command: operations.command,
          rename: operations.rename,
          resume: sessions.resume,
          switchAgent: sessions.switchAgent,
          switchModel: sessions.switchModel,
          interrupt: sessions.interrupt,
          synthetic: sessions.synthetic,
          wait: operations.wait,
        },
        job: {
          start: jobs.start,
          wait: jobs.wait,
          block: jobs.block,
          background: jobs.background,
          cancel: jobs.cancel,
        },
        scheduledTask: Option.match(scheduledTasks, {
          onNone: () => ({
            create: () => unavailable,
            get: () => unavailable,
            list: unavailable,
            update: () => unavailable,
            delete: () => unavailable,
            run: () => unavailable,
          }),
          onSome: (tasks) => ({
            create: tasks.create,
            get: tasks.get,
            list: tasks.list,
            update: tasks.update,
            delete: tasks.delete,
            run: tasks.run,
          }),
        }),
      } satisfies Interface
      cell.runtime = runtime
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (cell.runtime === runtime) cell.runtime = undefined
        }),
      )
    }),
  )

/** Install Session operations into the member-owned runtime cell. */
export const provider = <E>(input: {
  readonly session: WorkspaceNode<Session.Service, E>
  readonly operations: WorkspaceNode<SessionOperations.Service, E>
  readonly job: WorkspaceNode<Job.Service, E>
  readonly scheduledTask?: WorkspaceNode<ScheduledTask.Service, E>
  readonly readyAfter?: WorkspaceNode<never, E>
}) => {
  const install = makeWorkspaceNode({
    name: "@bymorning/core/PluginRuntime.provider",
    layer: Layer.unwrap(Effect.map(CellService, providerLayerWithCell)),
    deps: [
      cell,
      input.session,
      input.operations,
      input.job,
      ...(input.scheduledTask === undefined ? [] : [input.scheduledTask]),
      ...(input.readyAfter === undefined ? [] : [input.readyAfter]),
    ],
  })
  return { root: install, provider: install }
}

export * as PluginRuntime from "./runtime.js"
