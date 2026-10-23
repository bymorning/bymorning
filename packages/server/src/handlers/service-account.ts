import { Audit } from "@bymorning/core/audit"
import { ServiceAccount } from "@bymorning/core/service-account"
import { ServiceAccountNotFoundError } from "@bymorning/protocol/errors"
import { CurrentActor } from "@bymorning/protocol/middleware/workspace-middleware"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api.js"
import { requireAdmin } from "../middleware/admin.js"
import { audited } from "../middleware/audit.js"

/** ServiceAccount and inference API-key endpoint implementations. */
export const ServiceAccountHandler = HttpApiBuilder.group(Api, "api.service-account", (handlers) =>
  handlers
    .handle(
      "service-account.list",
      Effect.fn("ServiceAccountHandler.list")(function* () {
        const actor = yield* CurrentActor
        const serviceAccounts = yield* ServiceAccount.Service
        return yield* serviceAccounts.listSummaries(actor.properties.workspaceID)
      }),
    )
    .handle(
      "service-account.create",
      Effect.fn("ServiceAccountHandler.create")(function* ({ payload }) {
        const actor = yield* requireAdmin
        const serviceAccounts = yield* ServiceAccount.Service
        const workspaceID = actor.properties.workspaceID
        return yield* audited(
          serviceAccounts.create({ workspaceID, ...payload }),
          (account) => ({
            actor: Audit.principal(actor),
            action: "service-account.create",
            workspaceID,
            target: account.id,
            detail: { name: account.name },
            outcome: "success",
          }),
        )
      }),
    )
    .handle(
      "service-account.get",
      Effect.fn("ServiceAccountHandler.get")(function* ({ params }) {
        const actor = yield* CurrentActor
        const serviceAccounts = yield* ServiceAccount.Service
        const account = yield* serviceAccounts.get(actor.properties.workspaceID, params.id)
        if (account === undefined) return yield* notFound({ id: params.id })
        return account
      }),
    )
    .handle(
      "service-account.update",
      Effect.fn("ServiceAccountHandler.update")(function* ({ params, payload }) {
        const actor = yield* requireAdmin
        const serviceAccounts = yield* ServiceAccount.Service
        const workspaceID = actor.properties.workspaceID
        return yield* audited(
          serviceAccounts.update(workspaceID, params.id, payload).pipe(Effect.mapError(notFound)),
          (account) => ({
            actor: Audit.principal(actor),
            action: "service-account.update",
            workspaceID,
            target: account.id,
            detail: { changed: Object.keys(payload).sort() },
            outcome: "success",
          }),
        )
      }),
    )
    .handle(
      "service-account.remove",
      Effect.fn("ServiceAccountHandler.remove")(function* ({ params }) {
        const actor = yield* requireAdmin
        const serviceAccounts = yield* ServiceAccount.Service
        const workspaceID = actor.properties.workspaceID
        yield* audited(serviceAccounts.remove(workspaceID, params.id).pipe(Effect.mapError(notFound)), {
          actor: Audit.principal(actor),
          action: "service-account.remove",
          workspaceID,
          target: params.id,
          outcome: "success",
        })
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "service-account.key.list",
      Effect.fn("ServiceAccountHandler.key.list")(function* ({ params }) {
        const actor = yield* CurrentActor
        const serviceAccounts = yield* ServiceAccount.Service
        return yield* serviceAccounts.key.list(actor.properties.workspaceID, params.id)
      }),
    )
    .handle(
      "service-account.key.create",
      Effect.fn("ServiceAccountHandler.key.create")(function* ({ params, payload }) {
        const actor = yield* requireAdmin
        const serviceAccounts = yield* ServiceAccount.Service
        const workspaceID = actor.properties.workspaceID
        return yield* audited(
          serviceAccounts.key.create(workspaceID, params.id, payload).pipe(Effect.mapError(notFound)),
          (issued) => ({
            actor: Audit.principal(actor),
            action: "key.create",
            workspaceID,
            target: issued.key.id,
            detail: { serviceAccountID: params.id, name: issued.key.name, prefix: issued.key.prefix },
            outcome: "success",
          }),
        )
      }),
    )
    .handle(
      "service-account.key.revoke",
      Effect.fn("ServiceAccountHandler.key.revoke")(function* ({ params }) {
        const actor = yield* requireAdmin
        const serviceAccounts = yield* ServiceAccount.Service
        const workspaceID = actor.properties.workspaceID
        yield* audited(serviceAccounts.key.revoke(workspaceID, params.keyID).pipe(Effect.mapError(notFound)), {
          actor: Audit.principal(actor),
          action: "key.revoke",
          workspaceID,
          target: params.keyID,
          detail: { serviceAccountID: params.id },
          outcome: "success",
        })
        return HttpApiSchema.NoContent.make()
      }),
    ),
)

const notFound = (error: { readonly id: string }) =>
  new ServiceAccountNotFoundError({ id: error.id, message: `Service account resource not found: ${error.id}` })
