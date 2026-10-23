export * as Actor from "./actor.js"

import { Schema } from "effect"
import * as Account from "./account.js"
import * as ApiKey from "./api-key.js"
import * as ServiceAccount from "./service-account.js"
import * as User from "./user.js"
import * as Workspace from "./workspace.js"

/** A person identity before selecting a Workspace membership. */
export class AccountActor extends Schema.Class<AccountActor>("Actor.Account")({
  type: Schema.Literal("account"),
  properties: Schema.Struct({
    accountID: Account.ID,
  }),
}) {}

/** A Workspace-scoped service identity. */
export class WorkspaceActor extends Schema.Class<WorkspaceActor>("Actor.Workspace")({
  type: Schema.Literal("workspace"),
  properties: Schema.Struct({
    workspaceID: Workspace.ID,
  }),
}) {}

/** A person acting through one Workspace membership. */
export class UserActor extends Schema.Class<UserActor>("Actor.User")({
  type: Schema.Literal("user"),
  properties: Schema.Struct({
    accountID: Account.ID,
    userID: User.ID,
    workspaceID: Workspace.ID,
    role: User.Role,
  }),
}) {}

/** A Service Account acting through one of its Keys. */
export class ServiceAccountActor extends Schema.Class<ServiceAccountActor>("Actor.ServiceAccount")({
  type: Schema.Literal("service_account"),
  properties: Schema.Struct({
    workspaceID: Workspace.ID,
    serviceAccountID: ServiceAccount.ID,
    keyID: ApiKey.ID,
  }),
}) {}

/** An internal system identity scoped to one Workspace. */
export class SystemActor extends Schema.Class<SystemActor>("Actor.System")({
  type: Schema.Literal("system"),
  properties: Schema.Struct({
    workspaceID: Workspace.ID,
  }),
}) {}

/** Actor identities supported by Workspace operations. */
export const Info = Schema.Union([WorkspaceActor, UserActor, ServiceAccountActor, SystemActor])

/** Actor identity supported by Workspace operations. */
export type Info = typeof Info.Type

/** Actors authenticated from request Tokens. */
export const Caller = Schema.Union([UserActor, ServiceAccountActor])
/** Actors authenticated from request Tokens. */
export type Caller = typeof Caller.Type
