import { AuthProvider } from "@bymorning/core/auth-provider"
import { Audit } from "@bymorning/core/audit"
import { AuthProviderSchema } from "@bymorning/schema/auth-provider"
import { InputError, InternalError } from "@bymorning/protocol/errors"
import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api.js"
import { requireInstallationAdmin } from "../middleware/installation.js"

const unavailable = () => new InternalError({ error: "Auth Provider is unavailable" })
const invalid = () => new InputError({ error: "Auth Provider input is invalid" })

/** Installation-admin Auth Provider configuration endpoint implementations. */
export const AuthProviderHandler = HttpApiBuilder.group(Api, "api.auth-provider", (handlers) =>
  handlers
    .handle(
      "authProvider.list",
      Effect.fn("AuthProviderHandler.list")(function* () {
        yield* requireInstallationAdmin
        const providers = yield* AuthProvider.Service
        const infos = yield* providers.list().pipe(
          Effect.mapError(() => unavailable()),
          Effect.catchDefect(() => Effect.fail(unavailable())),
        )
        return [...infos]
      }),
    )
    .handle(
      "authProvider.create",
      Effect.fn("AuthProviderHandler.create")(function* ({ payload }) {
        const actor = yield* requireInstallationAdmin
        const input = yield* Schema.decodeUnknownEffect(AuthProviderSchema.Create)(payload).pipe(
          Effect.mapError(invalid),
        )
        const providers = yield* AuthProvider.Service
        return yield* providers.create(input, Audit.principal(actor)).pipe(
          Effect.catchTags({
            "AuthProvider.ConflictError": () => Effect.fail(new InputError({ error: "Auth Provider already exists" })),
            "AuthProvider.DiscoveryError": (error) => Effect.fail(new InputError({ error: error.message })),
            "AuthProvider.UnavailableError": () => Effect.fail(unavailable()),
          }),
          Effect.catchDefect(() => Effect.fail(unavailable())),
        )
      }),
    )
    .handle(
      "authProvider.get",
      Effect.fn("AuthProviderHandler.get")(function* ({ params }) {
        yield* requireInstallationAdmin
        const providers = yield* AuthProvider.Service
        return yield* providers.get(params.providerID).pipe(
          Effect.catchTags({
            "AuthProvider.MissingError": () => Effect.fail(new InputError({ error: "Auth Provider was not found" })),
            "AuthProvider.UnavailableError": () => Effect.fail(unavailable()),
          }),
          Effect.catchDefect(() => Effect.fail(unavailable())),
        )
      }),
    )
    .handle(
      "authProvider.update",
      Effect.fn("AuthProviderHandler.update")(function* ({ params, payload }) {
        const actor = yield* requireInstallationAdmin
        const input = yield* Schema.decodeUnknownEffect(AuthProviderSchema.Update)(payload).pipe(
          Effect.mapError(invalid),
        )
        if (input.id !== params.providerID) return yield* invalid()
        const providers = yield* AuthProvider.Service
        return yield* providers.update(input, Audit.principal(actor)).pipe(
          Effect.catchTags({
            "AuthProvider.MissingError": () => Effect.fail(new InputError({ error: "Auth Provider was not found" })),
            "AuthProvider.ConflictError": (error) => Effect.fail(new InputError({ error: error.message })),
            "AuthProvider.DiscoveryError": (error) => Effect.fail(new InputError({ error: error.message })),
            "AuthProvider.UnavailableError": () => Effect.fail(unavailable()),
          }),
          Effect.catchDefect(() => Effect.fail(unavailable())),
        )
      }),
    ),
)
