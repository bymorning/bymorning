import { Agent } from "@bymorning/core/agent"
import { AgentConflictError, AgentModelUnavailableError, AgentNotFoundError, ForbiddenError } from "@bymorning/protocol/errors"
import { AgentSchema } from "@bymorning/schema/agent"
import { CurrentActor } from "@bymorning/protocol/middleware/workspace-middleware"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api.js"

/** Agent management endpoint implementations. */
export const AgentHandler = HttpApiBuilder.group(Api, "api.agent", (handlers) =>
  handlers
    .handle("agent.list", () => Agent.Service.use((agent) => agent.list))
    .handle("agent.get", ({ params }) =>
      Effect.gen(function* () {
        const found = yield* Agent.Service.use((agent) => agent.get(params.id))
        if (found === undefined) return yield* notFound(params.id)
        return found
      }),
    )
    .handle("agent.create", ({ payload }) =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor
        if (payload.permissions.length > 0 && !administrator(actor))
          return yield* new ForbiddenError({ message: "Only Workspace administrators can change permissions" })
        // The Workspace has exactly one primary Agent, the built-in Default.
        // Everything created here is a subagent the Default Agent can call.
        if (payload.mode !== "subagent")
          return yield* new ForbiddenError({ message: "A created Agent must be a subagent" })
        const agent = yield* Agent.Service
        return yield* agent.create(payload).pipe(
          Effect.catchTags({
            "Agent.ConflictError": conflict,
            "Agent.ModelUnavailableError": modelUnavailable,
          }),
        )
      }),
    )
    .handle("agent.update", ({ params, payload }) =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor
        const agent = yield* Agent.Service
        const current = yield* agent.get(params.id)
        if (current === undefined) return yield* notFound(params.id)
        if (AgentSchema.BuiltIn.has(params.id) && !administrator(actor))
          return yield* new ForbiddenError({ message: "Only Workspace administrators can change a built-in Agent" })
        if (JSON.stringify(current.permissions) !== JSON.stringify(payload.permissions) && !administrator(actor))
          return yield* new ForbiddenError({ message: "Only Workspace administrators can change permissions" })
        // Mode decides where an Agent can be selected, so changing it would let
        // a created subagent become a second primary Agent.
        if (payload.mode !== current.mode)
          return yield* new ForbiddenError({ message: "An Agent's mode cannot be changed" })
        return yield* agent.update(params.id, payload).pipe(
          Effect.catchTags({
            "Agent.NotFoundError": (error) => notFound(error.id),
            "Agent.ModelUnavailableError": modelUnavailable,
          }),
        )
      }),
    )
    .handle("agent.delete", ({ params }) =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor
        const agent = yield* Agent.Service
        const current = yield* agent.get(params.id)
        if (current === undefined) return yield* notFound(params.id)
        if (AgentSchema.BuiltIn.has(params.id) && !administrator(actor))
          return yield* new ForbiddenError({ message: "Only Workspace administrators can reset a built-in Agent" })
        if (current.permissions.length > 0 && !administrator(actor))
          return yield* new ForbiddenError({ message: "Only Workspace administrators can delete an Agent with permission rules" })
        return yield* agent.delete(params.id).pipe(
          Effect.catchTag("Agent.NotFoundError", (error) => notFound(error.id)),
        )
      }),
    ),
)

const administrator = (actor: typeof CurrentActor.Service) =>
  actor.type === "user" && actor.properties.role === "admin"

const notFound = (id: AgentSchema.ID) => new AgentNotFoundError({ id, message: `Agent not found: ${id}` })
const conflict = (error: Agent.ConflictError) =>
  new AgentConflictError({ id: error.id, message: `Agent already exists: ${error.id}` })
const modelUnavailable = (error: Agent.ModelUnavailableError) =>
  new AgentModelUnavailableError({
    model: error.model,
    message: `Agent model unavailable: ${error.model.provider}/${error.model.id}${error.model.variant === undefined ? "" : `#${error.model.variant}`}`,
  })
