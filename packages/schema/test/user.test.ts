import { Account } from "@bymorning/schema/account"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { Schema } from "effect"
import { expect, test } from "vitest"

test("exports membership roles and requires an explicit Workspace when creating a User", () => {
  expect(Schema.decodeUnknownSync(User.Role)("admin")).toBe("admin")
  expect(() => Schema.decodeUnknownSync(User.Role)("owner")).toThrow()
  expect(() => Schema.decodeUnknownSync(User.Role)("viewer")).toThrow()

  const input = Schema.decodeUnknownSync(User.CreateInput)({
    accountID: Account.ID.create(),
    workspaceID: Workspace.ID.create(),
    role: "member",
  })

  expect(input.workspaceID).toMatch(/^wrk_/)
  expect(() => Schema.decodeUnknownSync(User.CreateInput)({ accountID: Account.ID.create(), role: "member" })).toThrow()
})

test("models pending and active Workspace members", () => {
  expect(Schema.decodeUnknownSync(User.InviteInput)({ email: " Person@ByMorning.AI ", role: "admin" })).toEqual({
    email: "person@bymorning.ai",
    role: "admin",
  })
  expect(() => Schema.decodeUnknownSync(User.InviteInput)({ email: "person@bymorning.ai", role: "owner" })).toThrow()
  expect(Schema.decodeUnknownSync(User.InviteInput)({ email: "person@other.test", role: "member" })).toEqual({
    email: "person@other.test",
    role: "member",
  })
  expect(() => Schema.decodeUnknownSync(User.InviteInput)({ email: "invalid", role: "member" })).toThrow()
  expect(
    Schema.decodeUnknownSync(User.MemberList)({
      role: "admin",
      members: [{ id: "usr_member", email: "person@bymorning.ai", role: "member", status: "pending" }],
    }),
  ).toEqual({
    role: "admin",
    members: [{ id: User.ID.make("usr_member"), email: "person@bymorning.ai", role: "member", status: "pending" }],
  })
})
