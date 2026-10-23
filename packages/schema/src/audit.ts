/** Installation security record. */
export * as Audit from "./audit.js"

import { Schema } from "effect"
import * as Account from "./account.js"
import * as ApiKey from "./api-key.js"
import { ascending } from "./identifier.js"
import { optional, statics } from "./schema.js"
import * as ServiceAccount from "./service-account.js"
import * as User from "./user.js"
import * as Workspace from "./workspace.js"

/** Identity of one Audit Entry. */
export const ID = Schema.String.check(Schema.isStartsWith("aud_")).pipe(
  Schema.brand("Audit.ID"),
  statics((schema) => ({ create: () => schema.make("aud_" + ascending()) })),
)
/** Identity of one Audit Entry. */
export type ID = typeof ID.Type

/**
 * One recorded security-relevant occurrence. The inventory covers actions wired
 * today and the actions owned by approved parallel work (member removal,
 * account suspension, server-side Login Session revocation, and Installation
 * Admin management), which record their Entries when those branches integrate.
 */
export const Action = Schema.Literals([
  "auth.login",
  "auth.logout",
  "auth.session.revoke",
  "user.invite",
  "user.accept",
  "user.role.update",
  "user.remove",
  "account.suspend",
  "account.restore",
  "config.update",
  "policy.write",
  "permission.write",
  "key.create",
  "key.revoke",
  "service-account.create",
  "service-account.update",
  "service-account.remove",
  "auth-provider.create",
  "auth-provider.update",
  // Historical: recorded by earlier releases; retained so existing audit rows still decode.
  "license.activate",
  "installation.admin.grant",
  "installation.admin.revoke",
  "installation.policy.update",
  "setup.complete",
  "session.delete",
  "share.create",
  "share.revoke",
  "file.upload",
  "file.delete",
  "file.move",
  "oauth.grant.create",
  "oauth.grant.revoke",
  "provider.update",
  "model.create",
  "model.update",
  "model.delete",
  "mcp.update",
  "credential.connect",
  "credential.update",
  "credential.remove",
  "budget.limit",
])
/** One recorded security-relevant occurrence. */
export type Action = typeof Action.Type

/** The compact attributed principal of one Entry. */
export const Principal = Schema.Union([
  /** A person before Workspace membership selection, such as a login. */
  Schema.Struct({ type: Schema.Literal("account"), accountID: Account.ID }),
  /** A person acting through one Workspace membership. */
  Schema.Struct({
    type: Schema.Literal("user"),
    accountID: Account.ID,
    userID: User.ID,
    workspaceID: Workspace.ID,
  }),
  /** A Service Account acting through one of its Keys. */
  Schema.Struct({
    type: Schema.Literal("service_account"),
    workspaceID: Workspace.ID,
    serviceAccountID: ServiceAccount.ID,
    keyID: ApiKey.ID,
  }),
  /** ByMorning itself, optionally within one Workspace. */
  Schema.Struct({ type: Schema.Literal("system"), workspaceID: optional(Workspace.ID) }),
  /** An unauthenticated caller, such as a failed login or Setup completion. */
  Schema.Struct({ type: Schema.Literal("anonymous"), email: optional(Schema.String) }),
])
/** The compact attributed principal of one Entry. */
export type Principal = typeof Principal.Type

/** Whether the recorded occurrence completed. */
export const Outcome = Schema.Literals(["success", "failure"])
/** Whether the recorded occurrence completed. */
export type Outcome = typeof Outcome.Type

/** Network context of the requesting client. */
export const Context = Schema.Struct({
  ip: optional(Schema.String),
  userAgent: optional(Schema.String),
})
/** Network context of the requesting client. */
export interface Context extends Schema.Schema.Type<typeof Context> {}

/** One immutable, insertion-ordered security record. */
export const Entry = Schema.Struct({
  id: ID,
  /** Insertion sequence; strictly increasing in commit order. */
  sequence: Schema.Number,
  occurredAt: Schema.Date,
  actor: Principal,
  action: Action,
  workspaceID: optional(Workspace.ID),
  target: optional(Schema.String),
  /** Secret-free structured detail; identifiers only, never values. */
  detail: optional(Schema.Record(Schema.String, Schema.Unknown)),
  outcome: Outcome,
  context: optional(Context),
  /** Tamper-evidence digest: sha256 over the previous Entry's chain and this Entry's canonical content. */
  chain: Schema.String,
})
/** One immutable, insertion-ordered security record. */
export interface Entry extends Schema.Schema.Type<typeof Entry> {}
