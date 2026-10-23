import { Integration } from "@bymorning/schema/integration"
import { Credential } from "@bymorning/schema/credential"
import { Form } from "@bymorning/schema/form"
import { AwsRegion } from "@bymorning/schema/aws-region"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ForbiddenError, IntegrationOAuthMethodNotFoundError, InternalError, InvalidRequestError } from "../errors.js"
import { WorkspaceQuery } from "../middleware/workspace-middleware.js"
import { IntegrationInfo } from "../integration-info.js"

/** HTTP API group for Integration discovery and key authentication. */
const AwsRegionConfiguration = Schema.Struct({ type: Schema.Literal("aws-region"), region: AwsRegion })

export const IntegrationGroup = HttpApiGroup.make("api.integration")
  .add(
    HttpApiEndpoint.get("integration.list", "/integration", {
      query: WorkspaceQuery,
      success: Schema.Array(IntegrationInfo),
      error: InternalError,
    }),
  )
  .add(
    HttpApiEndpoint.get("integration.get", "/integration/:integrationID", {
      params: { integrationID: Integration.ID },
      query: WorkspaceQuery,
      success: Schema.UndefinedOr(IntegrationInfo),
      error: InternalError,
    }),
  )
  .add(
    HttpApiEndpoint.post("integration.connect.key", "/integration/:integrationID/connect/key", {
      params: { integrationID: Integration.ID },
      query: WorkspaceQuery,
      payload: Schema.Struct({
        key: Schema.String,
        label: Schema.optional(Schema.String),
        scope: Schema.optional(Credential.Scope),
        answer: Schema.optional(Form.Answer),
        configuration: Schema.optional(AwsRegionConfiguration),
      }),
      success: HttpApiSchema.NoContent,
      error: [InvalidRequestError, ForbiddenError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.post("integration.connect.values", "/integration/:integrationID/connect/values", {
      params: { integrationID: Integration.ID },
      query: WorkspaceQuery,
      payload: Schema.Struct({
        /** The signed-in member's values by name. Omitted names keep the member's saved value. */
        values: Schema.Record(Schema.String, Schema.String),
        label: Schema.optional(Schema.String),
      }),
      success: HttpApiSchema.NoContent,
      error: [InvalidRequestError, ForbiddenError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.post("integration.connect.awsSigV4", "/integration/:integrationID/connect/aws-sigv4", {
      params: { integrationID: Integration.ID },
      query: WorkspaceQuery,
      payload: Schema.Struct({
        accessKeyId: Schema.NonEmptyString,
        secretAccessKey: Schema.NonEmptyString,
        sessionToken: Schema.optional(Schema.NonEmptyString),
        region: AwsRegion,
        label: Schema.optional(Schema.String),
        scope: Schema.optional(Credential.Scope),
        methodID: Schema.optional(Integration.MethodID),
      }),
      success: HttpApiSchema.NoContent,
      error: [InvalidRequestError, ForbiddenError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.put("integration.oauth.client.put", "/integration/:integrationID/oauth/:methodID/client", {
      params: { integrationID: Integration.ID, methodID: Integration.MethodID },
      query: WorkspaceQuery,
      payload: Schema.Struct({ answer: Form.Answer }),
      success: HttpApiSchema.NoContent,
      error: [InvalidRequestError, ForbiddenError, IntegrationOAuthMethodNotFoundError, InternalError],
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.integration.oauth.client.put" })),
  )
  .add(
    HttpApiEndpoint.delete("integration.oauth.client.remove", "/integration/:integrationID/oauth/:methodID/client", {
      params: { integrationID: Integration.ID, methodID: Integration.MethodID },
      query: WorkspaceQuery,
      success: HttpApiSchema.NoContent,
      error: [ForbiddenError, IntegrationOAuthMethodNotFoundError, InternalError],
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.integration.oauth.client.remove" })),
  )
  .add(
    HttpApiEndpoint.post("integration.oauth.connect", "/integration/:integrationID/connect/oauth", {
      params: { integrationID: Integration.ID },
      query: WorkspaceQuery,
      payload: Schema.Struct({
        methodID: Integration.MethodID,
        answer: Schema.optional(Form.Answer),
        label: Schema.optional(Schema.String),
        scope: Schema.optional(Credential.Scope),
      }),
      success: Integration.Attempt,
      error: [InvalidRequestError, ForbiddenError, InternalError],
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.integration.oauth.connect" })),
  )
  .add(
    HttpApiEndpoint.get("integration.oauth.status", "/integration/:integrationID/connect/oauth/:attemptID", {
      params: { integrationID: Integration.ID, attemptID: Integration.AttemptID },
      query: WorkspaceQuery,
      success: Integration.AttemptStatus,
      error: InternalError,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.integration.oauth.status" })),
  )
  .add(
    HttpApiEndpoint.post(
      "integration.oauth.complete",
      "/integration/:integrationID/connect/oauth/:attemptID/complete",
      {
        params: { integrationID: Integration.ID, attemptID: Integration.AttemptID },
        query: WorkspaceQuery,
        payload: Schema.Struct({ code: Schema.optional(Schema.String) }),
        success: HttpApiSchema.NoContent,
        error: [InvalidRequestError, InternalError],
      },
    ).annotateMerge(OpenApi.annotations({ identifier: "v2.integration.oauth.complete" })),
  )
  .add(
    HttpApiEndpoint.delete("integration.oauth.cancel", "/integration/:integrationID/connect/oauth/:attemptID", {
      params: { integrationID: Integration.ID, attemptID: Integration.AttemptID },
      query: WorkspaceQuery,
      success: HttpApiSchema.NoContent,
      error: InternalError,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.integration.oauth.cancel" })),
  )
  .add(
    HttpApiEndpoint.post("integration.command.connect", "/integration/:integrationID/connect/command", {
      params: { integrationID: Integration.ID },
      query: WorkspaceQuery,
      payload: Schema.Struct({
        methodID: Integration.MethodID,
        label: Schema.optional(Schema.String),
        scope: Schema.optional(Credential.Scope),
      }),
      success: Integration.CommandAttempt,
      error: [InvalidRequestError, ForbiddenError, InternalError],
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.integration.command.connect" })),
  )
  .add(
    HttpApiEndpoint.get("integration.command.status", "/integration/:integrationID/connect/command/:attemptID", {
      params: { integrationID: Integration.ID, attemptID: Integration.AttemptID },
      query: WorkspaceQuery,
      success: Integration.CommandAttemptStatus,
      error: InternalError,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.integration.command.status" })),
  )
  .add(
    HttpApiEndpoint.delete("integration.command.cancel", "/integration/:integrationID/connect/command/:attemptID", {
      params: { integrationID: Integration.ID, attemptID: Integration.AttemptID },
      query: WorkspaceQuery,
      success: HttpApiSchema.NoContent,
      error: InternalError,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.integration.command.cancel" })),
  )
  .prefix("/api")
