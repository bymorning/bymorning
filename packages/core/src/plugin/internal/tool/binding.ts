export * as Binding from "./binding.js"

import { Tool } from "../../../tool.js"
import type { Workspace } from "@bymorning/schema/workspace"
import type { Session } from "@bymorning/schema/session"
import { Context, Effect, Layer } from "effect"
import { ProjectDirectory } from "../../../project-directory.js"
import { Storage } from "../../../storage.js"
import { Bus } from "../../../bus.js"
import { Reference } from "../../../reference.js"
import { CodeInterpreter } from "../../../code-interpreter.js"
import { PluginRuntime } from "../../runtime.js"

type Dependency = ProjectDirectory.Service | Reference.Service | CodeInterpreter.Service

/** Private registration-time authority. Never consults the execution fiber's context. */
export class Service extends Context.Service<
  Service,
  {
    readonly workspaceID: Workspace.ID
    readonly provide: <A, E>(
      effect: Effect.Effect<A, E, Dependency>,
      context: Tool.Context,
    ) => Effect.Effect<A, E | Tool.Error>
  }
>()("@bymorning/core/PluginBuiltin") {}

export const make = (
  workspaceID: Workspace.ID,
  get: (sessionID: Session.ID) => Effect.Effect<Pick<Session.Info, "id" | "projectID">, Tool.Error>,
) =>
  Effect.gen(function* () {
    const storage = yield* Storage.Service
    const bus = yield* Bus.Service
    const reference = yield* Reference.Service
    const interpreter = yield* CodeInterpreter.Service
    return Service.of({
      workspaceID,
      provide: (effect, context) =>
        Effect.gen(function* () {
          if (context.caller.type !== "session")
            return yield* new Tool.Error({ message: "This Tool requires a Session caller" })
          const caller = context.caller
          const session = yield* get(caller.sessionID)
          if (session.id !== caller.sessionID || session.projectID !== caller.projectID)
            return yield* new Tool.Error({ message: "Session Tool caller does not match its Project" })
          return yield* effect.pipe(
            Effect.provide(ProjectDirectory.layer(workspaceID, session.projectID)),
            Effect.provideService(Storage.Service, storage),
            Effect.provideService(Bus.Service, bus),
            Effect.provideService(Reference.Service, reference),
            Effect.provideService(CodeInterpreter.Service, interpreter),
          )
        }),
    })
  })

export const layer = (workspaceID: Workspace.ID) =>
  Layer.effect(
    Service,
    PluginRuntime.Service.use((runtime) =>
      make(workspaceID, (sessionID) =>
        runtime.session
          .get(sessionID)
          .pipe(Effect.mapError((error) => new Tool.Error({ message: "Session Tool caller is unavailable", error }))),
      ),
    ),
  )

/** Discharge the explicit environment at setup; only the validated caller varies per invocation. */
export const bind = <Input extends Tool.ValueSchema, Output extends Tool.ValueSchema | undefined, E>(
  tool: Omit<Tool.Info<Input, Output>, "execute"> & {
    readonly execute: (
      input: Parameters<Tool.Info<Input, Output>["execute"]>[0],
      context: Tool.Context,
    ) => Effect.Effect<Tool.Result<Output>, E, Dependency>
  },
): Effect.Effect<Tool.Info<Input, Output>, never, Service> =>
  Effect.map(Service, (binding) => ({
    ...tool,
    execute: (input, context) =>
      binding
        .provide(tool.execute(input, context), context)
        .pipe(
          Effect.mapError((error) =>
            error instanceof Tool.Error ? error : new Tool.Error({ message: `Tool ${tool.name} failed`, error }),
          ),
        ),
  }))
