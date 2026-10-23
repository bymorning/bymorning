import { Audit } from "@bymorning/core/audit"
import { Installation } from "@bymorning/core/installation"
import type { UserActor } from "@bymorning/schema/actor"
import { InternalError, InvalidCursorError } from "@bymorning/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api.js"
import { requireAdmin } from "../middleware/admin.js"

/** Installation-wide read authority gate: whether the Account behind this membership is an Installation Admin. */
const isInstallationAdmin = (actor: UserActor) =>
  Installation.Service.use((installation) => installation.check(actor.properties.accountID)).pipe(
    Effect.catchDefect(() => Effect.succeed(false)),
  )

/** Audit Entry review endpoint implementations. */
export const AuditHandler = HttpApiBuilder.group(Api, "api.audit", (handlers) =>
  handlers.handle(
    "audit.list",
    Effect.fn("AuditHandler.list")(function* ({ query }) {
      const actor = yield* requireAdmin
      const audit = yield* Audit.Service
      const installationWide = yield* isInstallationAdmin(actor)
      const page = yield* audit
        .list({
          // Workspace administrators read their own Workspace only; an
          // Installation Admin reads every Workspace. A `workspace` selector
          // still passes the membership middleware first, so a selected read
          // reaches a Workspace the caller belongs to.
          ...(installationWide
            ? query.workspace === undefined
              ? {}
              : { workspaceID: query.workspace }
            : { workspaceID: actor.properties.workspaceID }),
          ...(query.actor === undefined ? {} : { accountID: query.actor }),
          ...(query.action === undefined ? {} : { actions: [query.action] }),
          ...(query.from === undefined ? {} : { from: query.from }),
          ...(query.to === undefined ? {} : { to: query.to }),
          ...(query.target === undefined ? {} : { target: query.target }),
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
        })
        .pipe(
          Effect.catchTags({
            "Audit.CursorError": () => Effect.fail(new InvalidCursorError({ message: "Invalid cursor" })),
            "Audit.StoreError": () => Effect.fail(new InternalError({ error: "Audit is unavailable" })),
          }),
        )
      return { data: [...page.data], ...(page.cursor === undefined ? {} : { cursor: page.cursor }) }
    }),
  ),
)
