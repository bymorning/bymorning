import * as Project from "@bymorning/schema/project"
import { Schema, SchemaTransformation } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema } from "effect/unstable/httpapi"
import {
  InputError,
  InternalError,
  ProjectDefaultError,
  ProjectFileConflictError,
  ProjectFileNotFoundError,
  ProjectNotFoundError,
} from "../errors.js"
import { WorkspaceQuery } from "../middleware/workspace-middleware.js"

const Patch = Schema.Struct({
  name: Project.UpdateInput.fields.name,
  icon: Schema.optionalKey(Schema.NullOr(Project.Icon)),
  archived: Project.UpdateInput.fields.archived,
})

const BooleanFromString = Schema.Literals(["true", "false"]).pipe(
  Schema.decodeTo(
    Schema.Boolean,
    SchemaTransformation.transform({
      decode: (value) => value === "true",
      encode: (value) => (value ? ("true" as const) : ("false" as const)),
    }),
  ),
)
/** Project list query: active Projects by default, only archived Projects with `archived=true`. */
const ListQuery = Schema.Struct({ ...WorkspaceQuery.fields, archived: Schema.optionalKey(BooleanFromString) })

const FilePath = Schema.Struct({ path: Schema.String })
const FileHeaders = Schema.Struct({ contentType: Schema.optionalKey(Schema.String) }).pipe(
  Schema.encodeKeys({ contentType: "content-type" }),
)
const DirectoryList = Schema.Struct({ paths: Schema.Array(Schema.String) })
const FileMove = Schema.Struct({ from: Schema.String, to: Schema.String })

/** Server middleware marker for the Project File upload body allowance. */
export class ProjectFileUploadMiddleware extends HttpApiMiddleware.Service<ProjectFileUploadMiddleware>()(
  "@bymorning/protocol/ProjectFileUploadMiddleware",
) {}

/** Workspace-authenticated Project CRUD HTTP contracts. */
export const ProjectGroup = HttpApiGroup.make("api.project")
  .add(
    HttpApiEndpoint.post("project.create", "/project", {
      query: WorkspaceQuery,
      payload: Project.CreateInput,
      success: Project.Info.pipe(HttpApiSchema.status(201)),
      error: [InputError, InternalError],
    }),
  )
  .add(HttpApiEndpoint.get("project.list", "/project", { query: ListQuery, success: Schema.Array(Project.Info) }))
  .add(
    HttpApiEndpoint.get("project.get", "/project/:projectID", {
      params: { projectID: Project.ID },
      query: WorkspaceQuery,
      success: Project.Info,
      error: [InputError, ProjectNotFoundError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.patch("project.update", "/project/:projectID", {
      params: { projectID: Project.ID },
      query: WorkspaceQuery,
      payload: Patch,
      success: Project.Info,
      error: [InputError, ProjectNotFoundError, ProjectDefaultError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.delete("project.delete", "/project/:projectID", {
      params: { projectID: Project.ID },
      query: WorkspaceQuery,
      success: HttpApiSchema.NoContent,
      error: [InputError, ProjectNotFoundError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.get("project.directory.list", "/project/:projectID/directory", {
      params: { projectID: Project.ID },
      query: WorkspaceQuery,
      success: DirectoryList,
      error: [InputError, ProjectNotFoundError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.get("project.directory.read", "/project/:projectID/directory/file", {
      params: { projectID: Project.ID },
      query: Schema.Struct({ ...FilePath.fields, ...WorkspaceQuery.fields }),
      success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
      error: [InputError, ProjectNotFoundError, ProjectFileNotFoundError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.put("project.directory.write", "/project/:projectID/directory/file", {
      params: { projectID: Project.ID },
      query: Schema.Struct({ ...FilePath.fields, ...WorkspaceQuery.fields }),
      headers: FileHeaders,
      payload: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
      success: HttpApiSchema.NoContent,
      error: [InputError, ProjectNotFoundError, InternalError],
    }).middleware(ProjectFileUploadMiddleware),
  )
  .add(
    HttpApiEndpoint.delete("project.directory.delete", "/project/:projectID/directory/file", {
      params: { projectID: Project.ID },
      query: Schema.Struct({ ...FilePath.fields, ...WorkspaceQuery.fields }),
      success: HttpApiSchema.NoContent,
      error: [InputError, ProjectNotFoundError, ProjectFileNotFoundError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.post("project.directory.move", "/project/:projectID/directory/move", {
      params: { projectID: Project.ID },
      query: WorkspaceQuery,
      payload: FileMove,
      success: HttpApiSchema.NoContent,
      error: [InputError, ProjectNotFoundError, ProjectFileNotFoundError, ProjectFileConflictError, InternalError],
    }),
  )
  .prefix("/api")
