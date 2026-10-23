import { Actor } from "@bymorning/schema/actor"
import { Account } from "@bymorning/schema/account"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { ApiKey } from "@bymorning/schema/api-key"
import { ServiceAccount } from "@bymorning/schema/service-account"
import { Schema } from "effect"
import { expect, test } from "vitest"

const workspaceID = Workspace.ID.create()

test("AccountActor carries only Account authority and remains outside Actor.Info", () => {
  const accountID = Account.ID.create()
  const actor = new Actor.AccountActor({ type: "account", properties: { accountID } })

  expect(Schema.decodeUnknownSync(Actor.AccountActor)(actor).properties).toEqual({ accountID })
  expect(() => Schema.decodeUnknownSync(Actor.Info)(actor)).toThrow()
})

test("decodes exactly the Workspace, User, and System variants", () => {
  const users = (["admin", "member"] as const).map(
    (role) =>
      new Actor.UserActor({
        type: "user",
        properties: {
          accountID: Account.ID.create(),
          userID: User.ID.create(),
          workspaceID,
          role,
        },
      }),
  )
  const values = [
    new Actor.WorkspaceActor({ type: "workspace", properties: { workspaceID } }),
    ...users,
    new Actor.ServiceAccountActor({
      type: "service_account",
      properties: { workspaceID, serviceAccountID: ServiceAccount.ID.create(), keyID: ApiKey.ID.create() },
    }),
    new Actor.SystemActor({ type: "system", properties: { workspaceID } }),
  ]

  expect(values.map((value) => Schema.decodeUnknownSync(Actor.Info)(value).type)).toEqual([
    "workspace",
    "user",
    "user",
    "service_account",
    "system",
  ])
  expect(users.map((user) => user.properties.role)).toEqual(["admin", "member"])
  expect(() => Schema.decodeUnknownSync(Actor.Info)({ type: "account", properties: {} })).toThrow()
  expect(() =>
    Schema.decodeUnknownSync(Actor.Info)({
      type: "user",
      properties: {
        accountID: Account.ID.create(),
        userID: User.ID.create(),
        workspaceID,
        role: "viewer",
      },
    }),
  ).toThrow()
})
