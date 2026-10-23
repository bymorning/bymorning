export * as WorkspaceAccess from "./workspace-access.js"

import { Schema } from "effect"
import * as User from "./user.js"
import * as Workspace from "./workspace.js"

/** A Workspace an Account can access, projected with the Account's membership role. */
export const Info = Workspace.Info.pipe(
  Schema.fieldsAssign({ role: User.Role }),
  Schema.annotate({ identifier: "WorkspaceAccess.Info" }),
)

/** A Workspace an Account can access, projected with the Account's membership role. */
export interface Info extends Schema.Schema.Type<typeof Info> {}
