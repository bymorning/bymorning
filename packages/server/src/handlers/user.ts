import { AuthProvider } from "@bymorning/core/auth-provider"
import { Installation } from "@bymorning/core/installation"
import { Audit } from "@bymorning/core/audit"
import { User } from "@bymorning/core/user"
import { ForbiddenError, InputError, ServiceUnavailableError } from "@bymorning/protocol/errors"
import { CurrentActor } from "@bymorning/protocol/middleware/workspace-middleware"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api.js"
import { requireAdmin } from "../middleware/admin.js"
import { audited } from "../middleware/audit.js"
import { WorkspaceMap } from "../workspace-map.js"

/**
 * Workspace membership operations for the Workspace selected by authenticated middleware.
 *
 * Invitation admission follows the Installation Policy: an explicit
 * `invitations.domains` restriction replaces the default union of enabled Auth
 * Provider domains and the Local Login domains (`localDomains`, empty on
 * non-loopback installations).
 */
export const UserHandler = (localDomains: ReadonlyArray<string> = []) =>
  HttpApiBuilder.group(Api, "api.user", (handlers) =>
    handlers
      .handle(
        "user.list",
        Effect.fn("UserHandler.list")(function* () {
          const actor = yield* CurrentActor
          if (actor.type !== "user") return yield* new ForbiddenError({ message: "User membership required" })
          const users = yield* User.Service
          return yield* users.list(actor)
        }),
      )
      .handle(
        "user.invite",
        Effect.fn("UserHandler.invite")(function* ({ payload }) {
          const actor = yield* requireAdmin
          const installation = yield* Installation.Service
          const policy = yield* installation.policy.get.pipe(
            Effect.catchDefect(() =>
              Effect.fail(new ServiceUnavailableError({ message: "Workspace invitation is unavailable" })),
            ),
          )
          const restricted = policy.invitations?.domains
          let admitted: ReadonlyArray<string>
          if (restricted !== undefined) {
            admitted = restricted.map((domain) => domain.toLowerCase())
          } else {
            const providers = yield* AuthProvider.Service
            const infos = yield* providers
              .list()
              .pipe(
                Effect.mapError(() => new ServiceUnavailableError({ message: "Workspace invitation is unavailable" })),
              )
            admitted = [
              ...localDomains.map((domain) => domain.toLowerCase()),
              ...infos.filter((info) => info.status === "enabled").flatMap((info) => info.domains),
            ]
          }
          const domain = payload.email.slice(payload.email.lastIndexOf("@") + 1)
          if (!admitted.includes(domain)) {
            return yield* new ForbiddenError({
              message:
                "Invitation email domain is not admitted. Ask an Installation admin to add this domain under Installation Policy → Invitation domains.",
            })
          }
          const users = yield* User.Service
          const workspaceID = actor.properties.workspaceID
          // Re-inviting an existing member with a different Role is today's
          // Role-change path; it records user.role.update instead of user.invite.
          return yield* Audit.audited(
            Effect.gen(function* () {
              const before = yield* users.list(actor)
              const existing = before.members.find((member) => member.email === payload.email)
              const member = yield* users.invite(workspaceID, payload)
              return { existing, member }
            }),
            ({ existing, member }) => ({
              actor: Audit.principal(actor),
              action: existing !== undefined && existing.role !== member.role ? "user.role.update" : "user.invite",
              workspaceID,
              target: member.id,
              detail: {
                email: member.email,
                role: member.role,
                ...(existing === undefined ? {} : { previousRole: existing.role }),
              },
              outcome: "success",
            }),
          ).pipe(
            Effect.map((result) => result.member),
            Effect.catchTags({
              "User.LastAdminError": () =>
                Effect.fail(
                  new ForbiddenError({
                    message: `${payload.email} is already the Workspace's only admin; an invitation cannot change their role.`,
                  }),
                ),
              "User.InviteError": () =>
                Effect.fail(new ServiceUnavailableError({ message: "Workspace invitation is unavailable" })),
              "Audit.StoreError": () =>
                Effect.fail(new ServiceUnavailableError({ message: "Workspace invitation is unavailable" })),
              SqlError: () =>
                Effect.fail(new ServiceUnavailableError({ message: "Workspace invitation is unavailable" })),
            }),
          )
        }),
      )
      .handle(
        "user.remove",
        Effect.fn("UserHandler.remove")(function* ({ params }) {
          const actor = yield* requireAdmin
          const users = yield* User.Service
          // Resolve the member's Account before removal so the retained
          // member-owned runtime can be ended.
          const members = yield* users.list(actor)
          const member = members.members.find((entry) => entry.id === params.userID)
          yield* audited(
            users.remove(actor.properties.workspaceID, params.userID).pipe(
              Effect.catchTags({
                "User.NotFoundError": () => Effect.fail(new InputError({ error: "Member was not found" })),
                "User.LastAdminError": () =>
                  Effect.fail(new InputError({ error: "The Workspace's last admin cannot be removed" })),
              }),
              Effect.catchDefect(() =>
                Effect.fail(new ServiceUnavailableError({ message: "Member removal is unavailable" })),
              ),
            ),
            {
              actor: Audit.principal(actor),
              action: "user.remove",
              workspaceID: actor.properties.workspaceID,
              target: params.userID,
              ...(member === undefined ? {} : { detail: { role: member.role } }),
              outcome: "success",
            },
          )
          if (member?.accountID != null) {
            const workspaces = yield* WorkspaceMap.Service
            yield* workspaces
              .invalidate({
                workspaceID: actor.properties.workspaceID,
                accountID: member.accountID,
                userID: member.id,
                role: member.role,
              })
              .pipe(Effect.orDie)
          }
        }),
      ),
  )
