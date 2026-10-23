import { Config } from "@bymorning/core/config"
import { Permission } from "@bymorning/core/permission"
import { Tool } from "@bymorning/core/tool"
import { Plugin } from "@bymorning/core/plugin"
import { User } from "@bymorning/core/user"
import { InputError, PermissionNotFoundError, SessionNotFoundError } from "@bymorning/protocol/errors"
import { Request } from "@bymorning/protocol/groups/permission"
import { CurrentActor } from "@bymorning/protocol/middleware/workspace-middleware"
import { Info } from "@bymorning/schema/config"
import { Effect, Schema } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api.js"
import { forbidden } from "../middleware/admin.js"

/** Permission discovery, reply, and saved-grant endpoint implementations. */
export const PermissionHandler = HttpApiBuilder.group(Api, "api.permission", (handlers) => {
  const sessionError = (error: import("@bymorning/schema/session").NotFoundError) =>
    new SessionNotFoundError({ sessionID: error.sessionID, message: `Session not found: ${error.sessionID}` })
  const requestError = (error: Permission.NotFoundError) =>
    new PermissionNotFoundError({
      requestID: error.requestID,
      message: `Permission request not found: ${error.requestID}`,
    })
  const encodeRequest = (request: import("@bymorning/schema/permission").Request) =>
    Schema.decodeUnknownEffect(Request)(request).pipe(Effect.orDie)
  const encodeRequests = (requests: ReadonlyArray<import("@bymorning/schema/permission").Request>) =>
    Effect.forEach(requests, encodeRequest).pipe(Effect.orDie)
  const selectedUser = (user: import("@bymorning/schema/user").ID | undefined) =>
    Effect.gen(function* () {
      if (user === undefined) return
      const actor = yield* CurrentActor
      if (actor.type !== "user") return yield* new InputError({ error: "User membership required" })
      const members = yield* User.Service.use((users) => users.list(actor))
      if (!members.members.some((member) => member.id === user))
        return yield* new InputError({ error: "Selected member is unavailable in this Workspace" })
    })
  const toolPermissions = (user?: import("@bymorning/schema/user").ID) => Effect.gen(function* () {
    yield* selectedUser(user)
    yield* Plugin.Supervisor.Service.use((supervisor) => supervisor.awaitActivation).pipe(Effect.orDie)
    const tool = yield* Tool.Service
    const config = yield* Config.Service
    const [actions, current] = yield* Effect.all([tool.actions(), config.get])
    const rules = [
      ...current.permissions.filter((rule) => rule.user === undefined),
      ...current.permissions.filter((rule) => user !== undefined && rule.user === user),
    ]
    return actions.map((registration) => {
      const { name, action } = registration
      return {
        name,
        action,
        description: registration.description,
        effect: Permission.evaluate(
          action,
          "*",
          rules,
        ).effect,
      }
    }).toSorted((left, right) => left.name.localeCompare(right.name))
  }).pipe(Effect.withSpan("Permission.tools.list"))
  const requirePermissionAuthor = Effect.gen(function* () {
    const actor = yield* CurrentActor
    if (actor.type !== "user" || actor.properties.role === "member")
      return yield* new InputError({ error: "Only Workspace administrators can change permissions" })
    return actor
  })
  return handlers
    .handle("permission.request.list", () =>
      Permission.Service.use((permission) => permission.list.pipe(Effect.flatMap(encodeRequests))),
    )
    .handle("permission.saved.list", () => Permission.Service.use((permission) => permission.saved))
    .handle("permission.saved.remove", ({ params }) =>
      Permission.Service.use((permission) => permission.forget(params.savedID)).pipe(
        Effect.as(HttpApiSchema.NoContent.make()),
      ),
    )
    .handle("permission.tools.list", ({ query }) => toolPermissions(query.user))
    .handle("permission.tools.update", ({ payload }) =>
      Effect.gen(function* () {
        const actor = yield* requirePermissionAuthor
        yield* Plugin.Supervisor.Service.use((supervisor) => supervisor.awaitActivation).pipe(Effect.orDie)
        yield* selectedUser(payload.user)
        const tool = yield* Tool.Service
        const config = yield* Config.Service
        const actions = new Set((yield* tool.actions()).map(({ action }) => action))
        const unknown = [...new Set(payload.tools.map((item) => item.action))].filter((action) => !actions.has(action))
        if (unknown.length > 0)
          return yield* new InputError({ error: `Unknown tool actions: ${unknown.toSorted().join(", ")}` })
        const selected = new Set(payload.tools.map((item) => item.action))
        const current = yield* config.get
        yield* config
          .update(
            yield* Schema.encodeEffect(Info)({
              ...current,
              permissions: [
                ...current.permissions.filter(
                  (rule) =>
                    rule.user !== payload.user || rule.resource !== "*" || !selected.has(rule.action),
                ),
                ...payload.tools.map(({ action, effect }) => ({
                  action,
                  resource: "*",
                  effect,
                  ...(payload.user === undefined ? {} : { user: payload.user }),
                })),
              ],
            }).pipe(Effect.orDie),
            actor,
          )
          .pipe(Effect.catchTag("Actor.ForbiddenError", forbidden))
        return yield* toolPermissions(payload.user)
      }).pipe(Effect.withSpan("Permission.tools.update")),
    )
    .handle("session.permission.create", ({ params, payload }) =>
      Permission.Service.use((permission) => permission.ask({ sessionID: params.sessionID, ...payload })).pipe(
        Effect.mapError(sessionError),
      ),
    )
    .handle("session.permission.list", ({ params }) =>
      Permission.Service.use((permission) => permission.forSession(params.sessionID)).pipe(
        Effect.mapError(sessionError),
        Effect.flatMap(encodeRequests),
      ),
    )
    .handle("session.permission.get", ({ params }) =>
      Permission.Service.use((permission) =>
        permission
          .forSession(params.sessionID)
          .pipe(
            Effect.mapError(sessionError),
            Effect.andThen(permission.get(params).pipe(Effect.mapError(requestError))),
            Effect.flatMap(encodeRequest),
          ),
      ),
    )
    .handle("session.permission.reply", ({ params, payload }) =>
      Permission.Service.use((permission) =>
        permission
          .forSession(params.sessionID)
          .pipe(
            Effect.mapError(sessionError),
            Effect.andThen(
              permission.reply({ ...params, ...payload }).pipe(
                Effect.mapError((error) =>
                  error._tag === "Permission.PermanentError"
                    ? new InputError({ error: error.message })
                    : requestError(error),
                ),
              ),
            ),
            Effect.as(HttpApiSchema.NoContent.make()),
          ),
      ),
    )
})
