import { IntegrationOAuthMethodNotFoundError, InternalError, InvalidRequestError, ForbiddenError } from "@bymorning/protocol/errors"
import { Cause, Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Audit } from "@bymorning/core/audit"
import { Integration } from "@bymorning/core/integration"
import { Actor } from "@bymorning/core/actor"
import { CurrentActor } from "@bymorning/protocol/middleware/workspace-middleware"
import { Api } from "../api.js"
import { requireAdmin } from "../middleware/admin.js"
import { audited } from "../middleware/audit.js"
import { cipherFailure } from "../middleware/cipher.js"

const authorize = <A, R>(
  effect: Effect.Effect<A, Integration.AuthorizationError | Actor.ForbiddenError, R>,
) =>
  effect.pipe(
    Effect.mapError((error) =>
      error._tag === "Actor.ForbiddenError"
        ? new ForbiddenError({ message: error.message })
        : new InvalidRequestError({ message: "Authentication failed" }),
    ),
  )

/**
 * Workspace-scoped Connections decide which external capabilities every member may
 * authenticate with, and permitted saved Connections can activate a Provider, so
 * only Workspace administrators establish them. Member-scoped Connections stay open
 * to the member they belong to.
 */
const requireWorkspaceConnectionAdmin = (integrationID: Integration.ID, scope: "member" | "workspace" | undefined) =>
  Effect.gen(function* () {
    if (scope === "member") return
    const integrations = yield* Integration.Service
    const info = yield* integrations.get(integrationID).pipe(Effect.catchCause(cipherFailure(internal)))
    if (info?.connectionPolicy === "member-only") return
    yield* requireAdmin
  })

/** Integration discovery and connection bindings. */
export const IntegrationHandler = HttpApiBuilder.group(Api, "api.integration", (handlers) =>
  handlers
    .handle(
      "integration.list",
      Effect.fn("IntegrationHandler.list")(function* () {
        const integrations = yield* Integration.Service
        // Listing resolves stored Connections, so a refused Cipher key is a 503 here.
        return yield* integrations.list().pipe(Effect.catchCause(cipherFailure(internal)))
      }),
    )
    .handle(
      "integration.get",
      Effect.fn("IntegrationHandler.get")(function* (ctx) {
        const integrations = yield* Integration.Service
        return yield* integrations.get(ctx.params.integrationID).pipe(Effect.catchCause(cipherFailure(internal)))
      }),
    )
    .handle(
      "integration.oauth.client.put",
      Effect.fn("IntegrationHandler.oauth.client.put")(function* (ctx) {
        // OAuth application setup is shared by every authorization for its method.
        const actor = yield* requireAdmin
        const integrations = yield* Integration.Service
        yield* audited(
          integrations.client.put({ ...ctx.params, answer: ctx.payload.answer }),
          {
            actor: Audit.principal(actor),
            action: "credential.connect",
            workspaceID: actor.properties.workspaceID,
            target: ctx.params.integrationID,
            detail: { methodID: ctx.params.methodID, kind: "oauth-client" },
            outcome: "success",
          },
        ).pipe(
          Effect.catchCause((cause) => {
            const error = Cause.squash(cause)
            const mapped =
              error instanceof Integration.OAuthMethodNotFoundError
                ? new IntegrationOAuthMethodNotFoundError({
                    ...ctx.params,
                    message: "OAuth client method not found",
                  })
                : error instanceof Integration.OAuthClientConfigurationInvalidError
                  ? new InvalidRequestError({ message: "OAuth client configuration is invalid" })
                  : internal()
            return Effect.fail(mapped)
          }),
        )
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "integration.oauth.client.remove",
      Effect.fn("IntegrationHandler.oauth.client.remove")(function* (ctx) {
        const actor = yield* requireAdmin
        const integrations = yield* Integration.Service
        yield* audited(integrations.client.remove(ctx.params), {
          actor: Audit.principal(actor),
          action: "credential.remove",
          workspaceID: actor.properties.workspaceID,
          target: ctx.params.integrationID,
          detail: { methodID: ctx.params.methodID, kind: "oauth-client" },
          outcome: "success",
        }).pipe(
          Effect.catchCause((cause) => {
            const error = Cause.squash(cause)
            return Effect.fail(
              error instanceof Integration.OAuthMethodNotFoundError
                ? new IntegrationOAuthMethodNotFoundError({
                    ...ctx.params,
                    message: "OAuth client method not found",
                  })
                : internal(),
            )
          }),
        )
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "integration.connect.key",
      Effect.fn("IntegrationHandler.key")(function* (ctx) {
        yield* requireWorkspaceConnectionAdmin(ctx.params.integrationID, ctx.payload.scope)
        const actor = yield* CurrentActor
        const integrations = yield* Integration.Service
        if (ctx.payload.answer !== undefined && ctx.payload.configuration !== undefined) {
          return yield* new InvalidRequestError({ message: "Specify either answer or configuration" })
        }
        // The Entry commits with the stored Credential (fail-closed); the key
        // value itself is never recorded — identifiers only.
        yield* audited(
          authorize(
            integrations.connection.key({
              integrationID: ctx.params.integrationID,
              key: ctx.payload.key,
              label: ctx.payload.label,
              scope: ctx.payload.scope,
              answer:
                ctx.payload.configuration === undefined
                  ? ctx.payload.answer
                  : { region: ctx.payload.configuration.region },
            }),
          ),
          {
            actor: Audit.principal(actor),
            action: "credential.connect",
            workspaceID: actor.properties.workspaceID,
            target: ctx.params.integrationID,
            detail: { scope: ctx.payload.scope ?? "workspace", method: "key" },
            outcome: "success",
          },
        )
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "integration.connect.values",
      Effect.fn("IntegrationHandler.values")(function* (ctx) {
        const actor = yield* CurrentActor
        const integrations = yield* Integration.Service
        // Member values are always the signed-in member's own Connection. The
        // Entry records only which Integration and names, never a value.
        yield* audited(
          integrations.connection
            .values({
              integrationID: ctx.params.integrationID,
              values: ctx.payload.values,
              label: ctx.payload.label,
            })
            .pipe(
              Effect.mapError((error) =>
                error._tag === "Actor.ForbiddenError"
                  ? new ForbiddenError({ message: error.message })
                  : new InvalidRequestError({ message: error.message }),
              ),
            ),
          {
            actor: Audit.principal(actor),
            action: "credential.connect",
            workspaceID: actor.properties.workspaceID,
            target: ctx.params.integrationID,
            detail: { scope: "member", method: "values", names: Object.keys(ctx.payload.values).toSorted() },
            outcome: "success",
          },
        )
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "integration.connect.awsSigV4",
      Effect.fn("IntegrationHandler.aws")(function* (ctx) {
        yield* requireWorkspaceConnectionAdmin(ctx.params.integrationID, ctx.payload.scope)
        if (ctx.payload.methodID !== undefined && ctx.payload.methodID !== Integration.BedrockAwsSigV4MethodID) {
          return yield* new InvalidRequestError({ message: "AWS SigV4 method not found" })
        }
        const actor = yield* CurrentActor
        const integrations = yield* Integration.Service
        // Secret material is never recorded — the Integration identity only.
        yield* audited(
          authorize(
            integrations.connection.awsSigV4({
              integrationID: ctx.params.integrationID,
              region: ctx.payload.region,
              accessKeyId: ctx.payload.accessKeyId,
              secretAccessKey: ctx.payload.secretAccessKey,
              sessionToken: ctx.payload.sessionToken,
              label: ctx.payload.label,
              scope: ctx.payload.scope,
            }),
          ),
          {
            actor: Audit.principal(actor),
            action: "credential.connect",
            workspaceID: actor.properties.workspaceID,
            target: ctx.params.integrationID,
            detail: { scope: ctx.payload.scope ?? "workspace", method: "aws-sigv4", region: ctx.payload.region },
            outcome: "success",
          },
        )
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "integration.oauth.connect",
      Effect.fn("IntegrationHandler.oauth.connect")(function* (ctx) {
        yield* requireWorkspaceConnectionAdmin(ctx.params.integrationID, ctx.payload.scope)
        const integrations = yield* Integration.Service
        return yield* integrations.oauth.connect({ integrationID: ctx.params.integrationID, ...ctx.payload }).pipe(
          Effect.catchCause((cause) => {
            const error = Cause.squash(cause)
            return Effect.fail(
              error instanceof Integration.OAuthClientConfigurationNotConfiguredError
                ? new InvalidRequestError({ message: "OAuth client configuration is required" })
                : error instanceof Integration.OAuthClientConfigurationInvalidError
                  ? new InvalidRequestError({ message: "OAuth client configuration is invalid" })
                  : error instanceof Integration.AuthorizationError
                    ? new InvalidRequestError({ message: "Authentication failed" })
                    : error instanceof Actor.ForbiddenError
                      ? new ForbiddenError({ message: error.message })
                      : internal(),
            )
          }),
        )
      }),
    )
    .handle(
      "integration.oauth.status",
      Effect.fn("IntegrationHandler.oauth.status")(function* (ctx) {
        const integrations = yield* Integration.Service
        const status = yield* integrations.oauth.status(ctx.params)
        return status.status === "failed" ? { ...status, message: "Authentication failed" } : status
      }),
    )
    .handle(
      "integration.oauth.complete",
      Effect.fn("IntegrationHandler.oauth.complete")(function* (ctx) {
        const actor = yield* CurrentActor
        const integrations = yield* Integration.Service
        yield* integrations.oauth.complete({ ...ctx.params, ...ctx.payload }).pipe(
          Effect.mapError(
            (error) =>
              new InvalidRequestError({
                message:
                  error._tag === "Integration.CodeRequired"
                    ? "Authorization code is required"
                    : "Authentication failed",
              }),
          ),
        )
        // The upstream token exchange precedes the Credential write, so this
        // Entry commits after the mutation rather than inside it; a record
        // failure still fails the call (no silent unaudited Connection).
        yield* Audit.record({
          actor: Audit.principal(actor),
          action: "credential.connect",
          workspaceID: actor.properties.workspaceID,
          target: ctx.params.integrationID,
          detail: { method: "oauth" },
          outcome: "success",
        }).pipe(
          Effect.catchTag("Audit.StoreError", () => Effect.fail(internal())),
        )
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "integration.oauth.cancel",
      Effect.fn("IntegrationHandler.oauth.cancel")(function* (ctx) {
        const integrations = yield* Integration.Service
        yield* integrations.oauth.cancel(ctx.params)
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "integration.command.connect",
      Effect.fn("IntegrationHandler.command.connect")(function* (ctx) {
        yield* requireWorkspaceConnectionAdmin(ctx.params.integrationID, ctx.payload.scope)
        const integrations = yield* Integration.Service
        return yield* authorize(
          integrations.command.connect({ integrationID: ctx.params.integrationID, ...ctx.payload }),
        )
      }),
    )
    .handle(
      "integration.command.status",
      Effect.fn("IntegrationHandler.command.status")(function* (ctx) {
        const integrations = yield* Integration.Service
        const status = yield* integrations.command.status(ctx.params)
        return status.status === "failed" ? { ...status, message: "Command failed" } : status
      }),
    )
    .handle(
      "integration.command.cancel",
      Effect.fn("IntegrationHandler.command.cancel")(function* (ctx) {
        const integrations = yield* Integration.Service
        yield* integrations.command.cancel(ctx.params)
        return HttpApiSchema.NoContent.make()
      }),
    ),
)

const internal = () => new InternalError({ error: "Internal server error" })
