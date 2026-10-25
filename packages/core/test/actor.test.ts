import { Actor } from "@bymorning/core/actor"
import { Account } from "@bymorning/schema/account"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { ApiKey } from "@bymorning/schema/api-key"
import { ServiceAccount } from "@bymorning/schema/service-account"
import { expect, test } from "vitest"

test("composes Budget Holders for a user Actor, Workspace first", () => {
  const workspaceID = Workspace.ID.create()
  const userID = User.ID.create()
  const actor = new Actor.UserActor({
    type: "user",
    properties: { accountID: Account.ID.create(), userID, workspaceID, role: "member" },
  })
  expect(Actor.holders(actor)).toEqual([`workspace:${workspaceID}`, `user:${workspaceID}:${userID}`])
})

test("composes Budget Holders for a ServiceAccountActor, Workspace first", () => {
  const workspaceID = Workspace.ID.create()
  const serviceAccountID = ServiceAccount.ID.create()
  const actor = new Actor.ServiceAccountActor({
    type: "service_account",
    properties: { workspaceID, serviceAccountID, keyID: ApiKey.ID.create() },
  })
  expect(Actor.holders(actor)).toEqual([
    `workspace:${workspaceID}`,
    `service-account:${workspaceID}:${serviceAccountID}`,
  ])
})
