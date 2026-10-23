import * as Agent from "@bymorning/schema/agent"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import {
  AgentConflictError,
  AgentModelUnavailableError,
  AgentNotFoundError,
  InputError,
  InternalError,
} from "../errors.js"
import { WorkspaceQuery } from "../middleware/workspace-middleware.js"

/** Authoritative Agent management HTTP contracts. */
export const AgentGroup = HttpApiGroup.make("api.agent")
  .add(
    HttpApiEndpoint.get("agent.list", "/agent", {
      query: WorkspaceQuery,
      success: Schema.Array(Agent.Info),
      error: [InputError, InternalError],
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.agent.list" })),
  )
  .add(
    HttpApiEndpoint.get("agent.get", "/agent/:id", {
      params: { id: Agent.ID },
      query: WorkspaceQuery,
      success: Agent.Info,
      error: [InputError, AgentNotFoundError, InternalError],
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.agent.get" })),
  )
  .add(
    HttpApiEndpoint.post("agent.create", "/agent", {
      query: WorkspaceQuery,
      payload: Agent.Info,
      success: Schema.suspend(() => Agent.Info).pipe(HttpApiSchema.status(201)),
      error: [InputError, AgentConflictError, AgentModelUnavailableError, InternalError],
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.agent.create" })),
  )
  .add(
    HttpApiEndpoint.put("agent.update", "/agent/:id", {
      params: { id: Agent.ID },
      query: WorkspaceQuery,
      payload: Agent.Update,
      success: Agent.Info,
      error: [InputError, AgentNotFoundError, AgentModelUnavailableError, InternalError],
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.agent.update" })),
  )
  .add(
    HttpApiEndpoint.delete("agent.delete", "/agent/:id", {
      params: { id: Agent.ID },
      query: WorkspaceQuery,
      success: Schema.Void.pipe(HttpApiSchema.status(204)),
      error: [InputError, AgentNotFoundError, InternalError],
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.agent.delete" })),
  )
  .prefix("/api")
