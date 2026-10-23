import { Session } from "@bymorning/schema/session"
import { SessionEvent } from "@bymorning/schema/session-event"
import { Workspace } from "@bymorning/schema/workspace"
import type { Permission as PermissionSchema } from "@bymorning/schema/permission"
import { and, eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Agent } from "../agent.js"
import { Config } from "../config.js"
import { Database, SessionTable } from "../database.js"
import { Permission } from "../permission.js"
import { Bus } from "../bus.js"
import { makeWorkspaceNode, type GlobalNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"
import { Actor } from "../actor.js"
import { User } from "@bymorning/schema/user"

/** Apply the effective Tool and runtime Permission policy for a Session. */
export const effectiveRules = (
  parentID: Session.ID | null,
  agentRules: PermissionSchema.Ruleset,
  workspaceRules: PermissionSchema.Ruleset,
  userID?: User.ID,
): PermissionSchema.Ruleset =>
  parentID === null
    ? [
        ...agentRules,
        ...workspaceRules.filter((rule) => rule.user === undefined),
        ...workspaceRules.filter((rule) => userID !== undefined && rule.user === userID),
      ]
    : [
        { action: "*", resource: "*", effect: "allow" },
        ...agentRules,
        ...workspaceRules.filter((rule) => rule.user === undefined),
        ...workspaceRules.filter((rule) => userID !== undefined && rule.user === userID),
        { action: "subagent", resource: "*", effect: "deny" },
      ]

/**
 * Nobody is present during a Scheduled Task run: an `ask` would block the Session indefinitely, so it is denied
 * instead, and the run cannot pose questions to the member.
 */
export const unattendedRules = (rules: PermissionSchema.Ruleset): PermissionSchema.Ruleset => [
  ...rules.map((rule) => (rule.effect === "ask" ? { ...rule, effect: "deny" as const } : rule)),
  { action: "question", resource: "*", effect: "deny" },
]

/** Bind Permission policy and event publication to Session's private services. */
export const layer = (
  workspaceID: Workspace.ID,
): Layer.Layer<Permission.Service, never, Agent.Service | Config.Service | Database.Service | Bus.Service> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const database = yield* Database.Service
      const agents = yield* Agent.Service
      const config = yield* Config.Service
      return Permission.layerWith(workspaceID, {
        configured: Effect.fn("PermissionPolicy.configured")(function* (sessionID, agent) {
          const [session] = yield* database.use("sessionSelectedAgent", (db) =>
            db
              .select({
                agent: SessionTable.agent,
                parentID: SessionTable.parentID,
                userID: SessionTable.userID,
                scheduledTaskID: SessionTable.scheduledTaskID,
              })
              .from(SessionTable)
              .where(and(eq(SessionTable.workspaceID, workspaceID), eq(SessionTable.id, sessionID)))
              .limit(1)
              .pipe(Effect.orDie),
          )
          if (session === undefined) return yield* new Session.NotFoundError({ sessionID })
          const selected = yield* agents.get(agent ?? session.agent)
          const workspace = yield* config.get
          const rules = effectiveRules(
            session.parentID,
            selected?.permissions ?? [{ action: "*", resource: "*", effect: "deny" }],
            workspace.permissions,
            session.userID,
          )
          return session.scheduledTaskID === null ? rules : unattendedRules(rules)
        }),
        asked: (request) => bus.publish(SessionEvent.PermissionAsked, request).pipe(Effect.orDie, Effect.asVoid),
        replied: (input) => bus.publish(SessionEvent.PermissionReplied, input).pipe(Effect.orDie, Effect.asVoid),
      })
    }),
  )

/** Canonical Session-aware Permission node for one Workspace. */
export const workspaceNodes = <E>(
  workspaceID: Workspace.ID,
  dependencies: {
    readonly agent: WorkspaceNode<Agent.Service, E>
    readonly database: GlobalNode<Database.Service, E>
    readonly bus: WorkspaceNode<Bus.Service, E>
    readonly config: WorkspaceNode<Config.Service, E>
  },
) =>
  makeWorkspaceNode({
    service: Permission.Service,
    layer: layer(workspaceID),
    deps: [dependencies.agent, dependencies.database, dependencies.bus, dependencies.config],
  })

/** Supported canonical Session-aware Permission integration for member graphs. */
export const node = makeWorkspaceNode({
  service: Permission.Service,
  layer: Layer.unwrap(Effect.map(Actor.Binding.Service, ({ workspaceID }) => layer(workspaceID))),
  deps: [Actor.binding, Agent.node, Database.node, Bus.node, Config.node],
})
export * as SessionPermission from "./permission.js"
