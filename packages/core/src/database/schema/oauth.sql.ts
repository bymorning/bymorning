import { Account } from "@bymorning/schema/account"
import { OAuthAuthorization } from "@bymorning/schema/oauth-authorization"
import { OAuthClient } from "@bymorning/schema/oauth-client"
import { OAuthGrant } from "@bymorning/schema/oauth-grant"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { sql } from "drizzle-orm"
import { check, foreignKey, index, jsonb, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core"
import { AccountTable } from "./account.sql.js"
import { timestamps, utc } from "./timestamps.js"
import { UserTable } from "./user.sql.js"
import { WorkspaceTable } from "./workspace.sql.js"

export const OAuthClientTable = pgTable("oauth_client", {
  id: varchar("id", { length: 30 }).$type<OAuthClient.ID>().primaryKey(),
  name: text(),
  redirectUris: jsonb("redirect_uris").$type<ReadonlyArray<string>>().notNull(),
  ...timestamps,
})

export const OAuthGrantTable = pgTable(
  "oauth_grant",
  {
    id: varchar("id", { length: 30 }).$type<OAuthGrant.ID>().primaryKey(),
    clientId: varchar("client_id", { length: 30 }).$type<OAuthClient.ID>().notNull(),
    accountId: varchar("account_id", { length: 30 }).$type<Account.ID>().notNull(),
    userId: varchar("user_id", { length: 30 }).$type<User.ID>().notNull(),
    workspaceId: varchar("workspace_id", { length: 30 }).$type<Workspace.ID>().notNull(),
    access_hash: text().notNull(),
    refresh_hash: text().notNull(),
    /**
     * The refresh hash the current one replaced. Presenting it again is token
     * reuse: the whole grant is revoked (OAuth 2.0 Security BCP family
     * revocation). Only the latest superseded hash is retained.
     */
    superseded_refresh_hash: text(),
    timeAccessExpires: utc("time_access_expires").notNull(),
    /** Absolute refresh expiry fixed at issuance; rotation does not extend it. */
    timeRefreshExpires: utc("time_refresh_expires").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("oauth_grant_access_hash_unique").on(table.access_hash),
    uniqueIndex("oauth_grant_refresh_hash_unique").on(table.refresh_hash),
    index("oauth_grant_account_idx").on(table.accountId),
    foreignKey({
      columns: [table.clientId],
      foreignColumns: [OAuthClientTable.id],
      name: "oauth_grant_client_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.accountId],
      foreignColumns: [AccountTable.id],
      name: "oauth_grant_account_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.userId],
      foreignColumns: [UserTable.workspaceId, UserTable.id],
      name: "oauth_grant_user_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [WorkspaceTable.id],
      name: "oauth_grant_workspace_fk",
    }).onDelete("cascade"),
  ],
)

export const OAuthAuthorizationTable = pgTable(
  "oauth_authorization",
  {
    id: varchar("id", { length: 30 }).$type<OAuthAuthorization.ID>().primaryKey(),
    clientId: varchar("client_id", { length: 30 }).$type<OAuthClient.ID>().notNull(),
    redirect_uri: text().notNull(),
    state: text(),
    code_challenge: text().notNull(),
    status: text({ enum: ["pending", "approved", "consumed"] }).notNull(),
    code_hash: text(),
    accountId: varchar("account_id", { length: 30 }).$type<Account.ID>(),
    userId: varchar("user_id", { length: 30 }).$type<User.ID>(),
    workspaceId: varchar("workspace_id", { length: 30 }).$type<Workspace.ID>(),
    grantId: varchar("grant_id", { length: 30 }).$type<OAuthGrant.ID>(),
    timeExpires: utc("time_expires").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("oauth_authorization_code_hash_unique").on(table.code_hash),
    check("oauth_authorization_status_check", sql`${table.status} in ('pending', 'approved', 'consumed')`),
    foreignKey({
      columns: [table.clientId],
      foreignColumns: [OAuthClientTable.id],
      name: "oauth_authorization_client_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.accountId],
      foreignColumns: [AccountTable.id],
      name: "oauth_authorization_account_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.userId],
      foreignColumns: [UserTable.workspaceId, UserTable.id],
      name: "oauth_authorization_user_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [WorkspaceTable.id],
      name: "oauth_authorization_workspace_fk",
    }).onDelete("cascade"),
  ],
)
