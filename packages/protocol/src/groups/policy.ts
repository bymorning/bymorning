import * as PolicySchema from "@bymorning/schema/policy"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"
import { ForbiddenError, InputError, InternalError, PolicyNotFoundError } from "../errors.js"
import { WorkspaceQuery } from "../middleware/workspace-middleware.js"

export const PolicyValidateSubject = Schema.Struct({
  type: Schema.Literal("policies"),
  policies: PolicySchema.Policies,
})
export type PolicyValidateSubject = typeof PolicyValidateSubject.Type

export const PolicyValidateResult = Schema.Struct({
  valid: Schema.Boolean,
  issues: Schema.Array(
    Schema.Struct({ path: Schema.Array(Schema.Union([Schema.String, Schema.Finite])), message: Schema.String }),
  ),
})
export type PolicyValidateResult = typeof PolicyValidateResult.Type

export const PolicySimulateSubject = Schema.Struct({
  action: Schema.String,
  resource: Schema.String,
})

export const PolicySimulateResult = Schema.Struct({
  guardrail: Schema.Struct({
    effect: Schema.Literals(["allow", "deny"]),
    message: Schema.optionalKey(Schema.String),
  }),
  route: Schema.optionalKey(Schema.String),
  trace: Schema.Array(PolicySchema.Trace),
})

export const DefinitionInput = Schema.Struct({
  ...PolicySchema.Policy.fields,
  enabled: Schema.optionalKey(Schema.Boolean),
}).annotate({ identifier: "Policy.DefinitionInput" })

const MutationErrors = [InputError, ForbiddenError, PolicyNotFoundError, InternalError] as const

/** Workspace-authenticated Policy inventory, validation, and simulation contracts. */
export const PolicyGroup = HttpApiGroup.make("api.policy")
  .add(
    HttpApiEndpoint.get("policy.list", "/policy", {
      query: WorkspaceQuery,
      success: Schema.Array(PolicySchema.Info),
      error: [InputError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.post("policy.create", "/policy", {
      query: WorkspaceQuery,
      payload: DefinitionInput,
      success: PolicySchema.Info,
      error: MutationErrors,
    }),
  )
  .add(
    HttpApiEndpoint.put("policy.update", "/policy/:policyID", {
      params: { policyID: Schema.String },
      query: WorkspaceQuery,
      payload: DefinitionInput,
      success: PolicySchema.Info,
      error: MutationErrors,
    }),
  )
  .add(
    HttpApiEndpoint.delete("policy.delete", "/policy/:policyID", {
      params: { policyID: Schema.String },
      query: WorkspaceQuery,
      success: HttpApiSchema.NoContent,
      error: MutationErrors,
    }),
  )
  .add(
    HttpApiEndpoint.put("policy.setEnabled", "/policy/:policyID/enabled", {
      params: { policyID: Schema.String },
      query: WorkspaceQuery,
      payload: Schema.Struct({ enabled: Schema.Boolean }),
      success: PolicySchema.Info,
      error: MutationErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("policy.validate", "/policy/validate", {
      query: WorkspaceQuery,
      payload: Schema.Unknown,
      success: PolicyValidateResult,
      error: [InputError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.post("policy.simulate", "/policy/simulate", {
      query: WorkspaceQuery,
      payload: PolicySimulateSubject,
      success: PolicySimulateResult,
      error: [InputError, InternalError],
    }),
  )
  .prefix("/api")
