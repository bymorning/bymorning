import { Installation } from "@bymorning/core/installation"
import { Audit } from "@bymorning/core/audit"
import { InputError, ServiceUnavailableError } from "@bymorning/protocol/errors"
import { CurrentAccount } from "@bymorning/protocol/middleware/account-middleware"
import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api.js"
import { requireInstallationAdmin } from "../middleware/installation.js"
import { audited } from "../middleware/audit.js"

const unavailable = () => new ServiceUnavailableError({ message: "Installation is unavailable" })
const invalid = () => new InputError({ error: "Installation Policy is invalid" })

/** Account-scoped Installation governance endpoint implementations; mutations require an Installation Admin. */
export const InstallationHandler = HttpApiBuilder.group(Api, "api.installation", (handlers) =>
  handlers
    .handle(
      "installation.self",
      Effect.fn("InstallationHandler.self")(function* () {
        const account = yield* CurrentAccount
        const installation = yield* Installation.Service
        const admin = yield* installation
          .check(account.properties.accountID)
          .pipe(Effect.catchDefect(() => Effect.fail(unavailable())))
        return { admin }
      }),
    )
    .handle(
      "installation.admin.list",
      Effect.fn("InstallationHandler.admin.list")(function* () {
        yield* requireInstallationAdmin
        const installation = yield* Installation.Service
        const admins = yield* installation.admin.list().pipe(
          Effect.mapError(() => unavailable()),
          Effect.catchDefect(() => Effect.fail(unavailable())),
        )
        return { admins: [...admins] }
      }),
    )
    .handle(
      "installation.admin.grant",
      Effect.fn("InstallationHandler.admin.grant")(function* ({ payload }) {
        const actor = yield* requireInstallationAdmin
        const installation = yield* Installation.Service
        yield* audited(
          installation.admin.grant(payload.accountID).pipe(
            Effect.catchTags({
              "Installation.NotFoundError": () => Effect.fail(new InputError({ error: "Account was not found" })),
              "Installation.UnavailableError": () => Effect.fail(unavailable()),
            }),
            Effect.catchDefect(() => Effect.fail(unavailable())),
          ),
          {
            actor: Audit.principal(actor),
            action: "installation.admin.grant",
            target: payload.accountID,
            outcome: "success",
          },
        )
        const admins = yield* installation.admin.list().pipe(
          Effect.mapError(() => unavailable()),
          Effect.catchDefect(() => Effect.fail(unavailable())),
        )
        return { admins: [...admins] }
      }),
    )
    .handle(
      "installation.admin.revoke",
      Effect.fn("InstallationHandler.admin.revoke")(function* ({ params }) {
        const actor = yield* requireInstallationAdmin
        const installation = yield* Installation.Service
        yield* audited(
          installation.admin.revoke(params.accountID).pipe(
            Effect.catchTags({
              "Installation.NotFoundError": () =>
                Effect.fail(new InputError({ error: "Account is not an Installation Admin" })),
              "Installation.LastAdminError": () =>
                Effect.fail(new InputError({ error: "The last Installation Admin cannot be revoked" })),
            }),
            Effect.catchDefect(() => Effect.fail(unavailable())),
          ),
          {
            actor: Audit.principal(actor),
            action: "installation.admin.revoke",
            target: params.accountID,
            outcome: "success",
          },
        )
        const admins = yield* installation.admin.list().pipe(
          Effect.mapError(() => unavailable()),
          Effect.catchDefect(() => Effect.fail(unavailable())),
        )
        return { admins: [...admins] }
      }),
    )
    .handle(
      "installation.policy.get",
      Effect.fn("InstallationHandler.policy.get")(function* () {
        yield* requireInstallationAdmin
        const installation = yield* Installation.Service
        return yield* installation.policy.get.pipe(Effect.catchDefect(() => Effect.fail(unavailable())))
      }),
    )
    .handle(
      "installation.policy.update",
      Effect.fn("InstallationHandler.policy.update")(function* ({ payload }) {
        const actor = yield* requireInstallationAdmin
        const policy = yield* Schema.decodeUnknownEffect(Installation.Policy)(payload).pipe(Effect.mapError(invalid))
        const installation = yield* Installation.Service
        yield* audited(
          installation.policy.update(policy).pipe(
            Effect.catchTags({
              "Installation.ValidationError": (error) => Effect.fail(new InputError({ error: error.message })),
            }),
            Effect.catchDefect(() => Effect.fail(unavailable())),
          ),
          {
            actor: Audit.principal(actor),
            action: "installation.policy.update",
            detail: { policy },
            outcome: "success",
          },
        )
        return policy
      }),
    ),
)
