import { Policy } from "@bymorning/core/policy"
import { Audit } from "@bymorning/core/audit"
import { ManagedPolicy } from "@bymorning/core/managed-policy"
import { PolicyValidateSubject, type PolicyValidateResult } from "@bymorning/protocol/groups/policy"
import { ForbiddenError, InputError, InternalError, PolicyNotFoundError } from "@bymorning/protocol/errors"
import { Effect, Exit, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api.js"
import { requireAdmin } from "../middleware/admin.js"

/** Managed Policies persist through Storage, which shares no transaction with the record store: record after success, and fail the call when the Entry cannot persist. */
const record = (input: Audit.RecordInput) =>
  Audit.record(input).pipe(
    Effect.catchTag("Audit.StoreError", () => Effect.fail(new InternalError({ error: "Audit is unavailable" }))),
  )

const strict = { errors: "all", onExcessProperty: "error" } as const

export const PolicyHandler = HttpApiBuilder.group(Api, "api.policy", (handlers) =>
  handlers
    .handle("policy.list", () => Policy.Service.use((policy) => policy.list))
    .handle("policy.create", ({ payload }) =>
      Effect.gen(function* () {
        const actor = yield* requireAdmin
        const managed = yield* ManagedPolicy.Service
        const info = yield* managed.create(payload).pipe(Effect.catchTags(managedErrors))
        yield* record({
          actor: Audit.principal(actor),
          action: "policy.write",
          workspaceID: actor.properties.workspaceID,
          target: info.id,
          detail: { operation: "create", name: info.name },
          outcome: "success",
        })
        return info
      }),
    )
    .handle("policy.update", ({ params, payload }) =>
      Effect.gen(function* () {
        const actor = yield* requireAdmin
        const managed = yield* ManagedPolicy.Service
        const info = yield* managed.update(params.policyID, payload).pipe(
          Effect.catchTags({
            ...storageErrors,
            "ManagedPolicy.NotFoundError": notFound,
            "ManagedPolicy.ValidationError": (error) => Effect.fail(new InputError({ error: error.message })),
          }),
        )
        yield* record({
          actor: Audit.principal(actor),
          action: "policy.write",
          workspaceID: actor.properties.workspaceID,
          target: params.policyID,
          detail: { operation: "update" },
          outcome: "success",
        })
        return info
      }),
    )
    .handle("policy.delete", ({ params }) =>
      Effect.gen(function* () {
        const actor = yield* requireAdmin
        const managed = yield* ManagedPolicy.Service
        yield* managed.delete(params.policyID).pipe(
          Effect.catchTags({
            "Storage.OperationError": storageErrors["Storage.OperationError"],
            "ManagedPolicy.NotFoundError": notFound,
            "Actor.ForbiddenError": storageErrors["Actor.ForbiddenError"],
          }),
        )
        yield* record({
          actor: Audit.principal(actor),
          action: "policy.write",
          workspaceID: actor.properties.workspaceID,
          target: params.policyID,
          detail: { operation: "delete" },
          outcome: "success",
        })
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle("policy.setEnabled", ({ params, payload }) =>
      Effect.gen(function* () {
        const actor = yield* requireAdmin
        const managed = yield* ManagedPolicy.Service
        const info = yield* managed.setEnabled(params.policyID, payload.enabled).pipe(
          Effect.catchTags({ ...storageErrors, "ManagedPolicy.NotFoundError": notFound }),
        )
        yield* record({
          actor: Audit.principal(actor),
          action: "policy.write",
          workspaceID: actor.properties.workspaceID,
          target: params.policyID,
          detail: { operation: "setEnabled", enabled: payload.enabled },
          outcome: "success",
        })
        return info
      }),
    )
    .handle("policy.validate", ({ payload }) => Effect.succeed(validatePolicyInput(payload)))
    .handle("policy.simulate", ({ payload }) =>
      Effect.gen(function* () {
        const policy = yield* Policy.Service
        return yield* policy.evaluate(payload.action, payload.resource)
      }),
    ),
)

const notFound = (error: ManagedPolicy.NotFoundError) =>
  Effect.fail(new PolicyNotFoundError({ id: error.id, message: `Policy not found: ${error.id}` }))

const storageErrors = {
  "Storage.OperationError": () => Effect.fail(new InternalError({ error: "Policy storage operation failed" })),
  "Storage.InputError": () => Effect.fail(new InternalError({ error: "Policy storage operation failed" })),
  // The ManagedPolicy domain seam refuses non-administrators itself; present it as 403.
  "Actor.ForbiddenError": (error: { readonly message: string }) =>
    Effect.fail(new ForbiddenError({ message: error.message })),
} as const

const managedErrors = {
  ...storageErrors,
  "ManagedPolicy.ConflictError": (error: ManagedPolicy.ConflictError) => Effect.fail(new InputError({ error: error.message })),
  "ManagedPolicy.ValidationError": (error: ManagedPolicy.ValidationError) =>
    Effect.fail(new InputError({ error: error.message })),
} as const

export const validatePolicyInput = (input: unknown): PolicyValidateResult => {
  const decoded = Schema.decodeUnknownExit(PolicyValidateSubject, strict)(input)
  if (Exit.isFailure(decoded)) return { valid: false, issues: [{ path: [], message: decoded.cause.toString() }] }
  return { valid: true, issues: [] }
}
