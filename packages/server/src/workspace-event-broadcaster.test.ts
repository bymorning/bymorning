import { Account } from "@bymorning/schema/account"
import { Workspace } from "@bymorning/schema/workspace"
import { Integration } from "@bymorning/schema/integration"
import { Bus } from "@bymorning/core/bus"
import { Effect } from "effect"
import { expect, test } from "vitest"
import { WorkspaceEventBroadcaster } from "./workspace-event-broadcaster.js"
import { WorkspaceMap } from "./workspace-map.js"

const bus = (events: string[], failure = false) =>
  ({
    publish: (definition: { readonly type: string }) =>
      failure ? Effect.die(new Error("expected sibling failure")) : Effect.sync(() => events.push(definition.type)),
  }) as unknown as Bus.Interface

test("fans out within a Workspace, ignores other Workspaces, and unregisters with graph scope", async () => {
  const first: string[] = []
  const sibling: string[] = []
  const foreign: string[] = []
  const firstAccountID = Account.ID.make("acc_broadcast_first")
  const siblingAccountID = Account.ID.make("acc_broadcast_sibling")
  const workspaceID = Workspace.ID.make("wrk_broadcast_same")
  const foreignWorkspaceID = Workspace.ID.make("wrk_broadcast_foreign")
  const runtime = (workspaceID: string, account: Account.ID) =>
    new WorkspaceMap.RuntimeKey({ workspaceID: Workspace.ID.make(workspaceID), accountID: account })

  await Effect.runPromise(
    Effect.gen(function* () {
      const broadcaster = yield* WorkspaceEventBroadcaster.Service
      yield* Effect.scoped(
        Effect.all(
          [
            broadcaster.register(workspaceID, runtime(workspaceID, firstAccountID), bus(first)),
            broadcaster.register(workspaceID, runtime(workspaceID, siblingAccountID), bus(sibling)),
            broadcaster.register(
              workspaceID,
              runtime(workspaceID, Account.ID.make("acc_broadcast_failure")),
              bus([], true),
            ),
            broadcaster.register(foreignWorkspaceID, runtime(foreignWorkspaceID, firstAccountID), bus(foreign)),
          ],
          { discard: true },
        ).pipe(
          Effect.andThen(broadcaster.publish(workspaceID, Integration.Event.Updated, {})),
          Effect.tap(() => {
            expect(first).toEqual(["integration.updated"])
            expect(sibling).toEqual(["integration.updated"])
            expect(foreign).toEqual([])
            return Effect.void
          }),
        ),
      )
      yield* broadcaster.publish(workspaceID, Integration.Event.Updated, {})
      expect(first).toHaveLength(1)
      expect(sibling).toHaveLength(1)
    }).pipe(Effect.provide(WorkspaceEventBroadcaster.layer)),
  )
})
