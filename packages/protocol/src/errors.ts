import * as Agent from "@bymorning/schema/agent"
import * as Model from "@bymorning/schema/model"
import * as Share from "@bymorning/schema/share"
import { Integration } from "@bymorning/schema/integration"
import { Workspace } from "@bymorning/schema/workspace"
import { Schema } from "effect"

const EmptyObject = Schema.Record(Schema.String, Schema.Never)

/** HTTP payload alternatives accepting either no body or a strict empty JSON object. */
export const EmptyPayload = [Schema.Undefined, EmptyObject] as const

/** An optional request body that accepts only no value or a strict empty object. */
export const EmptyInput = Schema.Union([Schema.Undefined, EmptyObject])

/** Safe response for malformed public Protocol input. */
export class InputError extends Schema.TaggedError<InputError>()(
  "Protocol.InputError",
  { error: Schema.String },
  { httpApiStatus: 400 },
) {}

/** Safe response for an unexpected public Protocol failure. */
export class InternalError extends Schema.TaggedError<InternalError>()(
  "Protocol.InternalError",
  { error: Schema.String },
  { httpApiStatus: 500 },
) {}

/** Safe response when a requested Session does not exist. */
export class SessionNotFoundError extends Schema.TaggedError<SessionNotFoundError>()(
  "Session.NotFoundError",
  { sessionID: Schema.String, message: Schema.String },
  { httpApiStatus: 404 },
) {}

/** Safe response when a requested Project does not exist. */
export class ProjectNotFoundError extends Schema.TaggedError<ProjectNotFoundError>()(
  "Project.NotFoundError",
  { projectID: Schema.String, message: Schema.String },
  { httpApiStatus: 404 },
) {}

/** Safe response when an operation would change an archived, read-only Project. */
export class ProjectArchivedError extends Schema.TaggedError<ProjectArchivedError>()(
  "Project.ArchivedError",
  { projectID: Schema.String, message: Schema.String },
  { httpApiStatus: 409 },
) {}

/** Safe response when archiving the Workspace's Default Project. */
export class ProjectDefaultError extends Schema.TaggedError<ProjectDefaultError>()(
  "Project.DefaultError",
  { projectID: Schema.String, message: Schema.String },
  { httpApiStatus: 409 },
) {}

/** Safe response when a requested Project File does not exist. */
export class ProjectFileNotFoundError extends Schema.TaggedError<ProjectFileNotFoundError>()(
  "ProjectFile.NotFoundError",
  { path: Schema.String, message: Schema.String },
  { httpApiStatus: 404 },
) {}

/** Safe response when another Project File already occupies the requested path. */
export class ProjectFileConflictError extends Schema.TaggedError<ProjectFileConflictError>()(
  "ProjectFile.ConflictError",
  { path: Schema.String, message: Schema.String },
  { httpApiStatus: 409 },
) {}

/** Safe response when a requested Scheduled Task does not exist. */
export class ScheduledTaskNotFoundError extends Schema.TaggedError<ScheduledTaskNotFoundError>()(
  "ScheduledTask.NotFoundError",
  { taskID: Schema.String, message: Schema.String },
  { httpApiStatus: 404 },
) {}

/** Safe response when a Scheduled Task cron expression or time zone is invalid. */
export class ScheduledTaskScheduleError extends Schema.TaggedError<ScheduledTaskScheduleError>()(
  "ScheduledTask.ScheduleError",
  { message: Schema.String },
  { httpApiStatus: 422 },
) {}

/** Safe response when a member already holds the maximum number of Scheduled Tasks. */
export class ScheduledTaskLimitError extends Schema.TaggedError<ScheduledTaskLimitError>()(
  "ScheduledTask.LimitError",
  { limit: Schema.Int, message: Schema.String },
  { httpApiStatus: 409 },
) {}

/** Safe response when a Scheduled Task run could not start. */
export class ScheduledTaskRunError extends Schema.TaggedError<ScheduledTaskRunError>()(
  "ScheduledTask.RunError",
  { taskID: Schema.String, message: Schema.String },
  { httpApiStatus: 409 },
) {}

/** Safe response when a requested Skill does not exist. */
export class SkillError extends Schema.TaggedError<SkillError>()(
  "Skill.Error",
  { skillID: Schema.String, message: Schema.String },
  { httpApiStatus: 404 },
) {}

/** Safe response when a requested Agent does not exist. */
export class AgentNotFoundError extends Schema.TaggedError<AgentNotFoundError>()(
  "Agent.NotFoundError",
  { id: Agent.ID, message: Schema.String },
  { httpApiStatus: 404 },
) {}

/** Safe response when a ServiceAccount or one of its API keys does not exist. */
export class ServiceAccountNotFoundError extends Schema.TaggedError<ServiceAccountNotFoundError>()(
  "ServiceAccount.NotFoundError",
  { id: Schema.String, message: Schema.String },
  { httpApiStatus: 404 },
) {}

/** Safe response when a requested managed or registered Policy does not exist. */
export class PolicyNotFoundError extends Schema.TaggedError<PolicyNotFoundError>()(
  "Policy.NotFoundError",
  { id: Schema.String, message: Schema.String },
  { httpApiStatus: 404 },
) {}

/** Safe response when an Agent with the requested ID already exists. */
export class AgentConflictError extends Schema.TaggedError<AgentConflictError>()(
  "Agent.ConflictError",
  { id: Agent.ID, message: Schema.String },
  { httpApiStatus: 409 },
) {}

/** Safe response when an Agent references a Model unavailable to the installation. */
export class AgentModelUnavailableError extends Schema.TaggedError<AgentModelUnavailableError>()(
  "Agent.ModelUnavailableError",
  { model: Model.Ref, message: Schema.String },
  { httpApiStatus: 400 },
) {}

/** Safe response when a pending Permission request is absent from its Session. */
export class PermissionNotFoundError extends Schema.TaggedError<PermissionNotFoundError>()(
  "Permission.NotFoundError",
  { requestID: Schema.String, message: Schema.String },
  { httpApiStatus: 404 },
) {}

export class FormNotFoundError extends Schema.TaggedError<FormNotFoundError>()(
  "Form.NotFoundError",
  { id: Schema.String, message: Schema.String },
  { httpApiStatus: 404 },
) {}
export class FormAlreadyExistsError extends Schema.TaggedError<FormAlreadyExistsError>()(
  "Form.AlreadyExistsError",
  { id: Schema.String, message: Schema.String },
  { httpApiStatus: 409 },
) {}
export class FormAlreadySettledError extends Schema.TaggedError<FormAlreadySettledError>()(
  "Form.AlreadySettledError",
  { id: Schema.String, message: Schema.String },
  { httpApiStatus: 409 },
) {}
export class FormInvalidAnswerError extends Schema.TaggedError<FormInvalidAnswerError>()(
  "Form.InvalidAnswerError",
  { id: Schema.String, message: Schema.String },
  { httpApiStatus: 400 },
) {}

/** Safe response when an OAuth authorization request is unavailable. */
export class OAuthRequestNotFoundError extends Schema.TaggedError<OAuthRequestNotFoundError>()(
  "OAuth.RequestNotFoundError",
  { requestID: Schema.String, message: Schema.String },
  { httpApiStatus: 404 },
) {}

/** Safe response when a requested Login Session does not exist for the caller. */
export class LoginSessionNotFoundError extends Schema.TaggedError<LoginSessionNotFoundError>()(
  "Auth.NotFoundError",
  { id: Schema.String, message: Schema.String },
  { httpApiStatus: 404 },
) {}

/** Safe response when a requested OAuth grant does not exist for the caller. */
export class OAuthGrantNotFoundError extends Schema.TaggedError<OAuthGrantNotFoundError>()(
  "OAuth.NotFoundError",
  { id: Schema.String, message: Schema.String },
  { httpApiStatus: 404 },
) {}

export class McpServerNotFoundError extends Schema.TaggedError<McpServerNotFoundError>()(
  "MCP.ServerNotFoundError",
  { server: Schema.String, message: Schema.String },
  { httpApiStatus: 404 },
) {}

/** Safe response when a Share token does not resolve to a public Session view. */
export class ShareNotFoundError extends Schema.TaggedError<ShareNotFoundError>()(
  "Share.NotFoundError",
  { workspaceID: Workspace.ID, token: Share.Token, message: Schema.String },
  { httpApiStatus: 404 },
) {}

/** Safe response when a Session prompt conflicts with an earlier admission. */
export class PromptConflictError extends Schema.TaggedError<PromptConflictError>()(
  "Session.PromptConflictError",
  { sessionID: Schema.String, messageID: Schema.String, message: Schema.String },
  { httpApiStatus: 409 },
) {}

/** Safe response when synthetic Session input conflicts with an earlier identity. */
export class SyntheticConflictError extends Schema.TaggedError<SyntheticConflictError>()(
  "Session.SyntheticConflictError",
  { sessionID: Schema.String, messageID: Schema.String, message: Schema.String },
  { httpApiStatus: 409 },
) {}

/** Safe response when a Session compaction conflicts with an earlier admission. */
export class CompactionConflictError extends Schema.TaggedError<CompactionConflictError>()(
  "Session.CompactionConflictError",
  { sessionID: Schema.String, messageID: Schema.String, message: Schema.String },
  { httpApiStatus: 409 },
) {}

/** Safe response for a malformed or mismatched pagination cursor. */
export class InvalidCursorError extends Schema.TaggedError<InvalidCursorError>()(
  "Session.InvalidCursorError",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

/** Safe response for an invalid registration or model request. */
export class InvalidRequestError extends Schema.TaggedError<InvalidRequestError>()(
  "InvalidRequestError",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

export class IntegrationOAuthMethodNotFoundError extends Schema.TaggedError<IntegrationOAuthMethodNotFoundError>()(
  "Integration.OAuthMethodNotFoundError",
  { integrationID: Integration.ID, methodID: Integration.MethodID, message: Schema.String },
  { httpApiStatus: 404 },
) {}

/** Safe response for missing or invalid caller authentication. */
export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
  "UnauthorizedError",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

/** Safe response for an authenticated caller without required authority. */
export class ForbiddenError extends Schema.TaggedError<ForbiddenError>()(
  "ForbiddenError",
  { message: Schema.String },
  { httpApiStatus: 403 },
) {}

/** Safe response when a requested Model does not exist. */
export class ModelNotFoundError extends Schema.TaggedError<ModelNotFoundError>()(
  "ModelNotFoundError",
  { message: Schema.String },
  { httpApiStatus: 404 },
) {}

/** Safe response when no configured Provider can serve a request. */
export class ServiceUnavailableError extends Schema.TaggedError<ServiceUnavailableError>()(
  "ServiceUnavailableError",
  { message: Schema.String },
  { httpApiStatus: 503 },
) {}
