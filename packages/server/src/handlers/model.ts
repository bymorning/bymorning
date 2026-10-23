import { Actor } from "@bymorning/core/actor"
import { Budget } from "@bymorning/core/budget"
import { Catalog } from "@bymorning/core/catalog"
import type { Config } from "@bymorning/core/config"
import { Routing } from "@bymorning/core/routing"
import { LLMGateway } from "@bymorning/gateway/llm-gateway"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api.js"
import { ForbiddenError, InputError, ServiceUnavailableError } from "@bymorning/protocol/errors"
import { Audit } from "@bymorning/core/audit"
import { CurrentActor } from "@bymorning/protocol/middleware/workspace-middleware"
import { requireAdmin } from "../middleware/admin.js"
import { Effect } from "effect"

export const ModelHandler = HttpApiBuilder.group(Api, "api.model", (handlers) =>
  handlers
    .handle("model.list", ({ query }) => Catalog.Service.use((catalog) => catalog.model.visible(query.provider)))
    .handle("model.auto", () => Routing.Service.use((routing) => routing.names))
    .handle("model.route", ({ payload }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const actor = yield* CurrentActor
          if (actor.type !== "user" || actor.properties.role !== "admin")
            return yield* new ForbiddenError({ message: "Only Workspace administrators can test routing" })
          const budget = yield* Budget.Service
          const gateway = yield* LLMGateway.Service
          const holders = Actor.holders(actor)
          const decision = yield* gateway
            .preview({
              workspaceID: actor.properties.workspaceID,
              model: payload.model,
              prompt: payload.prompt,
              ...(payload.purpose === undefined ? {} : { purpose: payload.purpose }),
              // The judge is real inference, charged to and attributed to this administrator.
              principal: { type: "user", userID: actor.properties.userID },
              reserve: (estimate) => budget.reserve(holders, estimate === undefined ? undefined : { estimate }),
            })
            .pipe(
              Effect.mapError((error) =>
                error._tag === "Routing.UnresolvedError"
                  ? new InputError({ error: `No routing rule matches ${error.model.provider}/${error.model.id}` })
                  : error._tag === "Routing.UnavailableError"
                    ? new InputError({ error: `No Tier of routing rule ${error.rule + 1} can serve this request` })
                    : new InputError({ error: "Routing is unavailable" }),
              ),
            )
          return {
            model: decision.model,
            route: decision.route,
            ...(decision.judge === undefined ? {} : { judge: decision.judge }),
          }
        }),
      ),
    )
    .handle("model.toggle", ({ payload }) =>
      Effect.gen(function* () {
        // Shared Model enablement is a Workspace admission decision; members keep browser-local Picker Visibility.
        const actor = yield* requireAdmin
        const catalog = yield* Catalog.Service
        return yield* catalog.model
          .toggle(payload, actor)
          .pipe(Effect.mapError(() => new InputError({ error: "Model is not visible" })))
      }),
    )
    .handle("model.create", ({ payload }) =>
      Effect.gen(function* () {
        const actor = yield* requireAdmin
        const catalog = yield* Catalog.Service
        const created = yield* audited(
          catalog.model.create(payload, actor),
          actor,
          "model.create",
          (row) => row.info,
          "Model could not be added",
        )
        yield* LLMGateway.Lease.Service.use((lease) => lease.invalidate(actor.properties.workspaceID))
        return created
      }),
    )
    .handle("model.update", ({ payload }) =>
      Effect.gen(function* () {
        const actor = yield* requireAdmin
        const catalog = yield* Catalog.Service
        const updated = yield* audited(
          catalog.model.update(payload, actor),
          actor,
          "model.update",
          (row) => row.info,
          "Model could not be saved",
        )
        yield* LLMGateway.Lease.Service.use((lease) => lease.invalidate(actor.properties.workspaceID))
        return updated
      }),
    )
    .handle("model.delete", ({ query }) =>
      Effect.gen(function* () {
        const actor = yield* requireAdmin
        const catalog = yield* Catalog.Service
        const model = { provider: query.provider, id: query.id }
        yield* audited(
          catalog.model.delete(model, actor),
          actor,
          "model.delete",
          () => ({ ...model, name: undefined, apiID: undefined }),
          "Model could not be removed",
        )
        yield* LLMGateway.Lease.Service.use((lease) => lease.invalidate(actor.properties.workspaceID))
      }),
    )
    .handle("model.default", ({ payload }) =>
      Effect.gen(function* () {
        const actor = yield* requireAdmin
        const catalog = yield* Catalog.Service
        return yield* catalog.model
          .setDefault(payload, actor)
          .pipe(Effect.mapError(() => new InputError({ error: "Model is not usable" })))
      }),
    ),
)

type CustomError =
  Catalog.ConflictError | Catalog.MissingError | Catalog.NotFoundError | Config.StorageError | Actor.ForbiddenError

/** Map custom Model failures onto protocol errors. */
const customError = (error: CustomError, unavailable: string) => {
  switch (error._tag) {
    case "Actor.ForbiddenError":
      return new ForbiddenError({ message: error.message })
    case "Catalog.ConflictError":
      return new InputError({
        error: `${error.model.provider} already has a Model with the key ${error.model.id}; enable that Model or choose another key`,
      })
    case "Catalog.MissingError":
      return new InputError({ error: "Only custom Models can be changed or removed" })
    case "Catalog.NotFoundError":
      return new InputError({ error: "Provider was not found" })
    default:
      return new ServiceUnavailableError({ message: unavailable })
  }
}

/** Custom Model changes are security-relevant; the Entry commits with the Config write (fail-closed). */
const audited = <A>(
  operation: Effect.Effect<A, CustomError>,
  actor: Actor.Info & { readonly properties: { readonly workspaceID: string } },
  action: "model.create" | "model.update" | "model.delete",
  describe: (value: A) => {
    readonly provider: string
    readonly id: string
    readonly name?: string
    readonly apiID?: string
  },
  unavailable: string,
) =>
  Audit.audited(operation.pipe(Effect.mapError((error) => customError(error, unavailable))), (value) => {
    const model = describe(value)
    return {
      actor: Audit.principal(actor),
      action,
      workspaceID: actor.properties.workspaceID,
      target: `${model.provider}/${model.id}`,
      detail: {
        provider: model.provider,
        id: model.id,
        ...(model.name === undefined ? {} : { name: model.name }),
        ...(model.apiID === undefined ? {} : { apiID: model.apiID }),
      },
      outcome: "success",
    }
  }).pipe(
    Effect.catchTags({
      "Audit.StoreError": () => Effect.fail(new ServiceUnavailableError({ message: unavailable })),
      SqlError: () => Effect.fail(new ServiceUnavailableError({ message: unavailable })),
    }),
  )
