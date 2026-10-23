import { Catalog } from "@bymorning/core/catalog"
import { Audit } from "@bymorning/core/audit"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api.js"
import { InputError, ForbiddenError, ServiceUnavailableError } from "@bymorning/protocol/errors"
import { LLMGateway } from "@bymorning/gateway/llm-gateway"
import { requireAdmin } from "../middleware/admin.js"

/** Code-backed Provider discovery endpoint implementations. */
export const ProviderHandler = HttpApiBuilder.group(Api, "api.provider", (handlers) =>
  handlers.handle(
    "provider.list",
    Effect.fn("ProviderHandler.list")(function* () {
      const catalog = yield* Catalog.Service
      return yield* catalog.provider.directory()
    }),
  ).handle("provider.update", ({ payload }) =>
    Effect.gen(function* () {
      const actor = yield* requireAdmin
      const catalog = yield* Catalog.Service
      const lease = yield* LLMGateway.Lease.Service
      // Provider Activation changes are security-relevant; the Entry commits
      // with the Catalog write (fail-closed). The Catalog enforces the admin
      // Role again at the domain seam.
      const updated = yield* Audit.audited(
        catalog.provider.update(payload, actor).pipe(
          Effect.mapError((error) =>
            error._tag === "Actor.ForbiddenError"
              ? new ForbiddenError({ message: error.message })
              : error._tag === "Catalog.NotFoundError"
                ? new InputError({ error: "Provider was not found" })
                : new ServiceUnavailableError({ message: "Provider activation could not be saved" }),
          ),
        ),
        (info) => ({
          actor: Audit.principal(actor),
          action: "provider.update",
          workspaceID: actor.properties.workspaceID,
          target: payload.provider,
          detail: { status: payload.status, displayName: info.displayName },
          outcome: "success",
        }),
      ).pipe(
        Effect.catchTags({
          "Audit.StoreError": () =>
            Effect.fail(new ServiceUnavailableError({ message: "Provider activation could not be saved" })),
          SqlError: () => Effect.fail(new ServiceUnavailableError({ message: "Provider activation could not be saved" })),
        }),
      )
      yield* lease.invalidate(actor.properties.workspaceID)
      return updated
    }),
  ),
)
