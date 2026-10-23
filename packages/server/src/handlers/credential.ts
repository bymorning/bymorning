import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Audit } from "@bymorning/core/audit"
import { Integration } from "@bymorning/core/integration"
import type { Credential } from "@bymorning/schema/credential"
import { InternalError } from "@bymorning/protocol/errors"
import { CurrentActor } from "@bymorning/protocol/middleware/workspace-middleware"
import { Api } from "../api.js"
import { forbidden, requireAdmin } from "../middleware/admin.js"
import { audited } from "../middleware/audit.js"
import { cipherFailure } from "../middleware/cipher.js"

/**
 * Shared Workspace Connections authenticate every member's traffic to their
 * Integration, so only Workspace administrators relabel, activate, or remove them.
 * A member keeps managing the member-scoped Connections visible to that member.
 */
const requireWorkspaceCredentialAdmin = (credentialID: Credential.ID) =>
  Effect.gen(function* () {
    const integrations = yield* Integration.Service
    const list = yield* integrations.list().pipe(Effect.catchCause(cipherFailure(internal)))
    const connection = list
      .flatMap((info) => info.connections)
      .find((candidate) => "id" in candidate && candidate.id === credentialID)
    if (connection !== undefined && "scope" in connection && connection.scope === "member") return
    yield* requireAdmin
  })

/** Persisted Credential disconnection binding. */
export const CredentialHandler = HttpApiBuilder.group(Api, "api.credential", (handlers) =>
  handlers
    .handle(
      "credential.update",
      Effect.fn("CredentialHandler.update")(function* (ctx) {
        yield* requireWorkspaceCredentialAdmin(ctx.params.credentialID)
        const actor = yield* CurrentActor
        const integrations = yield* Integration.Service
        yield* audited(
          integrations.connection
            .update(ctx.params.credentialID, { label: ctx.payload.label })
            .pipe(Effect.catchTag("Actor.ForbiddenError", forbidden)),
          {
            actor: Audit.principal(actor),
            action: "credential.update",
            workspaceID: actor.properties.workspaceID,
            target: ctx.params.credentialID,
            detail: { label: ctx.payload.label },
            outcome: "success",
          },
        )
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "credential.activate",
      Effect.fn("CredentialHandler.activate")(function* (ctx) {
        yield* requireWorkspaceCredentialAdmin(ctx.params.credentialID)
        const actor = yield* CurrentActor
        const integrations = yield* Integration.Service
        yield* audited(
          integrations.connection
            .activate(ctx.params.credentialID)
            .pipe(Effect.catchTag("Actor.ForbiddenError", forbidden)),
          {
            actor: Audit.principal(actor),
            action: "credential.update",
            workspaceID: actor.properties.workspaceID,
            target: ctx.params.credentialID,
            detail: { activated: true },
            outcome: "success",
          },
        )
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "credential.remove",
      Effect.fn("CredentialHandler.remove")(function* (ctx) {
        yield* requireWorkspaceCredentialAdmin(ctx.params.credentialID)
        const actor = yield* CurrentActor
        const integrations = yield* Integration.Service
        yield* audited(
          integrations.connection
            .remove(ctx.params.credentialID)
            .pipe(Effect.catchTag("Actor.ForbiddenError", forbidden)),
          {
            actor: Audit.principal(actor),
            action: "credential.remove",
            workspaceID: actor.properties.workspaceID,
            target: ctx.params.credentialID,
            outcome: "success",
          },
        )
        return HttpApiSchema.NoContent.make()
      }),
    ),
)

const internal = () => new InternalError({ error: "Internal server error" })
