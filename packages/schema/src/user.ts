export * as User from "./user.js"
export * as UserSchema from "./user.js"
import { Schema } from "effect"
import * as Account from "./account.js"
import * as Auth from "./auth.js"
import { ascending } from "./identifier.js"
import { statics } from "./schema.js"
import * as Workspace from "./workspace.js"

export const ID = Schema.String.check(Schema.isStartsWith("usr_")).pipe(
  Schema.brand("User.ID"),
  statics((schema) => {
    const create = () => schema.make("usr_" + ascending())
    return {
      ascending: (id?: string) => {
        if (!id) return create()
        return schema.make(id)
      },
      create,
    }
  }),
)

export type ID = typeof ID.Type

export const Role = Schema.Literals(["admin", "member"])

export type Role = typeof Role.Type

export const InvitationRole = Schema.Literals(["admin", "member"])

export type InvitationRole = typeof InvitationRole.Type

export const Status = Schema.Literals(["active", "pending"])

export type Status = typeof Status.Type

export const Info = Schema.Struct({
  id: ID,
  accountId: Schema.NullOr(Account.ID),
  email: Schema.NullOr(Auth.Email),
  workspaceId: Workspace.ID,
  role: Role,
})

export interface Info extends Schema.Schema.Type<typeof Info> {}

export const InviteInput = Schema.Struct({
  email: Auth.Email,
  role: InvitationRole,
})

export interface InviteInput extends Schema.Schema.Type<typeof InviteInput> {}

export const Member = Schema.Struct({
  id: ID,
  email: Auth.Email,
  role: Role,
  status: Status,
  /** The member's Account, present once an invitation is claimed; used by member removal and Account suspension. */
  accountID: Schema.optionalKey(Schema.NullOr(Account.ID)),
})

export interface Member extends Schema.Schema.Type<typeof Member> {}

export const MemberList = Schema.Struct({
  role: Role,
  members: Schema.Array(Member),
})

export interface MemberList extends Schema.Schema.Type<typeof MemberList> {}

/** Input for creating a User membership in a Workspace. */
export const CreateInput = Schema.Struct({
  accountID: Account.ID,
  workspaceID: Workspace.ID,
  role: Role,
})

/** Input for creating a User membership in a Workspace. */
export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
