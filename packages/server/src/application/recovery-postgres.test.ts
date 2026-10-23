import {
  Database,
  AccountTable,
  ProjectTable,
  SessionInboxTable,
  SessionMessageTable,
  SessionTable,
  UserTable,
  WorkspaceTable,
} from "@bymorning/core/database"
import { AgentSchema } from "@bymorning/schema/agent"
import { MessageSchema } from "@bymorning/schema/message"
import { ProviderSchema } from "@bymorning/schema/provider"
import { ProjectSchema } from "@bymorning/schema/project"
import { SessionSchema } from "@bymorning/schema/session"
import { empty } from "@bymorning/schema/usage"
import { WorkspaceSchema } from "@bymorning/schema/workspace"
import { AccountSchema } from "@bymorning/schema/account"
import { UserSchema } from "@bymorning/schema/user"
import { and, eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { expect, it } from "vitest"
import { postgres } from "../../test/postgres.js"
import { WorkspaceMap } from "../workspace-map.js"
import { WorkspaceRecovery } from "./recovery.js"

const database = postgres()

it("acquires only Workspaces with durable work requiring recovery", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const databaseService = yield* Database.Service
      const agent = AgentSchema.ID.make("recovery")
      const now = new Date()
      const recoverableInboxWorkspaces = [
        WorkspaceSchema.ID.ascending("wrk_recovery_first"),
        WorkspaceSchema.ID.ascending("wrk_recovery_second"),
      ] as const
      const unavailableWorkspace = WorkspaceSchema.ID.ascending("wrk_recovery_deleted_owner")
      const inboxWorkspaces = [...recoverableInboxWorkspaces, unavailableWorkspace]
      const messageWorkspaces = [
        {
          workspaceID: WorkspaceSchema.ID.ascending("wrk_recovery_unknown"),
          finish: "unknown",
        },
        {
          workspaceID: WorkspaceSchema.ID.ascending("wrk_recovery_tool_error"),
          finish: "tool-error",
        },
        {
          workspaceID: WorkspaceSchema.ID.ascending("wrk_recovery_unfinished"),
          finish: "unfinished",
        },
        {
          workspaceID: WorkspaceSchema.ID.ascending("wrk_recovery_default"),
          finish: "stop",
        },
      ] as const
      const childOnlyWorkspace = WorkspaceSchema.ID.ascending("wrk_recovery_child_only")
      const childParentID = SessionSchema.ID.make("00000000-0000-4000-8000-000000000099")
      const workspaces = [
        ...inboxWorkspaces,
        ...messageWorkspaces.map((fixture) => fixture.workspaceID),
        childOnlyWorkspace,
      ]
      const sessions = new Map(
        workspaces.map((workspaceID, index) => [
          workspaceID,
          SessionSchema.ID.make(`00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`),
        ]),
      )
      const runtimeOwners = new Map<WorkspaceSchema.ID, WorkspaceMap.Owner>()

      yield* databaseService.use("WorkspaceRecoveryPostgresTest.setup", (db) =>
        Effect.gen(function* () {
          for (const workspaceID of workspaces) {
            const projectID = ProjectSchema.ID.create()
            const accountID = AccountSchema.ID.create()
            const userID = UserSchema.ID.create()
            runtimeOwners.set(workspaceID, { workspaceID, accountID, userID, role: "admin" })
            yield* db.insert(WorkspaceTable).values({
              id: workspaceID,
              name: "Recovery",
              status: "active",
              timeCreated: now,
              timeUpdated: now,
            })
            yield* db.insert(ProjectTable).values({
              workspaceID,
              id: projectID,
              name: "Default",
              timeCreated: now,
              timeUpdated: now,
            })
            yield* db.insert(AccountTable).values({ id: accountID, status: "active" })
            yield* db
              .insert(UserTable)
              .values({ id: userID, workspaceId: workspaceID, accountId: accountID, role: "admin" })
            if (workspaceID === childOnlyWorkspace)
              yield* db.insert(SessionTable).values({
                id: childParentID,
                workspaceID,
                userID,
                projectID,
                agent,
                model: { id: "recovery", provider: ProviderSchema.Bymorning },
                timeCreated: now,
                timeUpdated: now,
              })
            yield* db.insert(SessionTable).values({
              id: sessions.get(workspaceID)!,
              workspaceID,
              userID,
              projectID,
              ...(workspaceID === childOnlyWorkspace ? { parentID: childParentID } : {}),
              agent,
              model: { id: "recovery", provider: ProviderSchema.Bymorning },
              timeCreated: now,
              timeUpdated: now,
            })
          }

          for (const [index, workspaceID] of inboxWorkspaces.entries()) {
            yield* db.insert(SessionInboxTable).values({
              id: MessageSchema.ID.make(`00000000-0000-4000-8001-${String(index + 1).padStart(12, "0")}`),
              sessionID: sessions.get(workspaceID)!,
              admittedSequence: 1,
              type: "user",
              payload: { text: "resume" },
              delivery: "queue",
              timeCreated: now,
            })
          }
          const unavailableOwner = runtimeOwners.get(unavailableWorkspace)
          if (!unavailableOwner) throw new Error("missing unavailable owner")
          yield* db
            .update(UserTable)
            .set({ timeDeleted: now })
            .where(
              and(eq(UserTable.workspaceId, unavailableOwner.workspaceID), eq(UserTable.id, unavailableOwner.userID)),
            )
          yield* db.insert(SessionInboxTable).values({
            id: MessageSchema.ID.make("00000000-0000-4000-8001-000000000099"),
            sessionID: sessions.get(childOnlyWorkspace)!,
            admittedSequence: 1,
            type: "user",
            payload: { text: "owned child" },
            delivery: "queue",
            timeCreated: now,
          })

          for (const [index, fixture] of messageWorkspaces.entries()) {
            const sessionID = sessions.get(fixture.workspaceID)!
            const messageID = MessageSchema.ID.make(`00000000-0000-4000-8002-${String(index + 1).padStart(12, "0")}`)
            const data = MessageSchema.Assistant.make({
              id: messageID,
              sessionID,
              sequence: 1,
              createdAt: now,
              type: "assistant",
              agent,
              model: { id: "recovery", provider: ProviderSchema.Bymorning },
              content:
                fixture.finish === "tool-error"
                  ? [
                      {
                        type: "tool" as const,
                        id: "tool-error",
                        name: "recover",
                        providerExecuted: false,
                        state: {
                          status: "error" as const,
                          input: {},
                          error: { _tag: "SessionError.ToolError" as const, message: "interrupted" },
                        },
                        time: { created: now, completed: now },
                      },
                    ]
                  : [],
              ...(fixture.finish === "unknown" ? { finish: "unknown" as const } : {}),
              ...(fixture.finish === "stop" ? { finish: "stop" as const } : {}),
              time: { created: now, ...(fixture.finish === "unfinished" ? {} : { completed: now }) },
              usage: empty,
            })
            yield* db.insert(SessionMessageTable).values({
              id: messageID,
              sessionID,
              sequence: 1,
              type: "assistant",
              data,
              timeCreated: now,
              timeUpdated: now,
            })
          }
        }),
      )

      const acquired = Array<WorkspaceMap.Owner>()
      const workspaceMap = WorkspaceMap.layerFromFactory({
        services: (owner) =>
          // This recovery test observes graph acquisition without reconstructing the production Workspace graph.
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- omitted capabilities are not used by recovery
          Layer.effectDiscard(Effect.sync(() => acquired.push(owner))) as Layer.Layer<WorkspaceMap.Capabilities>,
      })
      const databaseLayer = Layer.succeed(Database.Service, databaseService)

      yield* Effect.gen(function* () {
        const recovery = yield* WorkspaceRecovery.Service
        const workspaces = yield* WorkspaceMap.Service
        yield* recovery.recover

        expect(new Set(acquired.map(({ workspaceID }) => workspaceID))).toEqual(
          new Set([...recoverableInboxWorkspaces, ...messageWorkspaces.slice(0, 3).map((x) => x.workspaceID)]),
        )
        expect(acquired).toEqual(acquired.map((owner) => runtimeOwners.get(owner.workspaceID)))
        expect(acquired.map(({ workspaceID }) => workspaceID)).not.toContain(messageWorkspaces[3].workspaceID)
        expect(acquired.map(({ workspaceID }) => workspaceID)).not.toContain(childOnlyWorkspace)
        expect(acquired.map(({ workspaceID }) => workspaceID)).not.toContain(unavailableWorkspace)

        const defaultOwner = runtimeOwners.get(messageWorkspaces[3].workspaceID)
        if (defaultOwner === undefined) throw new Error("missing runtime owner")
        yield* Effect.void.pipe(Effect.provide(workspaces.get(defaultOwner)))
        expect(acquired.map(({ workspaceID }) => workspaceID)).toContain(messageWorkspaces[3].workspaceID)
      }).pipe(
        Effect.provide(
          Layer.merge(
            workspaceMap,
            WorkspaceRecovery.layer.pipe(Layer.provide(databaseLayer), Layer.provide(workspaceMap)),
          ),
        ),
      )
    }).pipe(Effect.scoped, Effect.provide(database)),
  )
}, 30_000)
