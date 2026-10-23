import * as Skill from "@bymorning/schema/skill"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"
import { ForbiddenError, InputError, InternalError, SkillError } from "../errors.js"
import { WorkspaceQuery } from "../middleware/workspace-middleware.js"

/** Workspace-authenticated Skill management contracts. */
export const SkillGroup = HttpApiGroup.make("api.skill")
  .add(
    HttpApiEndpoint.get("skill.list", "/skill", {
      query: WorkspaceQuery,
      success: Schema.Array(Skill.Info),
      error: [InputError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.get("skill.get", "/skill/:skillID", {
      params: { skillID: Skill.ID },
      query: WorkspaceQuery,
      success: Skill.Info,
      error: [InputError, SkillError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.post("skill.create", "/skill", {
      query: WorkspaceQuery,
      payload: Skill.Create,
      success: Skill.Info.pipe(HttpApiSchema.status(201)),
      error: [InputError, ForbiddenError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.put("skill.update", "/skill/:skillID", {
      params: { skillID: Skill.ID },
      query: WorkspaceQuery,
      payload: Skill.Create,
      success: Skill.Info,
      error: [InputError, ForbiddenError, SkillError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.delete("skill.delete", "/skill/:skillID", {
      params: { skillID: Skill.ID },
      query: WorkspaceQuery,
      success: HttpApiSchema.NoContent,
      error: [InputError, ForbiddenError, SkillError, InternalError],
    }),
  )
  .prefix("/api")
