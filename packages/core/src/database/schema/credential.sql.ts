import { Form } from "@bymorning/schema/form"
import { User } from "@bymorning/schema/user"
import { Credential } from "@bymorning/schema/credential"
import { Integration } from "@bymorning/schema/integration"
import { Workspace } from "@bymorning/schema/workspace"
import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core"
import { timestamps } from "./timestamps.js"
import { UserTable } from "./user.sql.js"
import { WorkspaceTable } from "./workspace.sql.js"

export const CredentialTable = pgTable(
  "credential",
  {
    id: varchar("id", { length: 40 }).$type<Credential.ID>().notNull(),
    workspaceId: varchar("workspace_id", { length: 30 }).$type<Workspace.ID>().notNull(),
    purpose: text({ enum: ["connection", "client"] })
      .notNull()
      .default("connection"),
    userID: varchar("user_id", { length: 30 }).$type<User.ID>(),
    method_id: text().$type<Integration.MethodID>(),
    integration_id: text().$type<Integration.ID>().notNull(),
    label: text().notNull(),
    active: boolean(),
    // Secret material is Cipher-encrypted at rest: a plaintext legacy value
    // (migration window) or a `v1.` envelope string, never a live secret.
    value: text(),
    valueJson: jsonb("value_json").$type<Credential.Value | Form.Answer | string>().notNull(),
    // OAuth token-generation digests (sha256 hex), so conditional writes never
    // use secret values as predicates and value_json can stay encrypted.
    oauth_access_hash: text(),
    oauth_refresh_hash: text(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [WorkspaceTable.id],
      name: "credential_workspace_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.userID],
      foreignColumns: [UserTable.workspaceId, UserTable.id],
      name: "credential_member_fk",
    }).onDelete("cascade"),
    check(
      "credential_purpose_check",
      sql`(${table.purpose} = 'connection' and ${table.method_id} is null) or (${table.purpose} = 'client' and ${table.userID} is null and ${table.method_id} is not null and ${table.active} is null)`,
    ),
    index("credential_workspace_integration").on(table.workspaceId, table.integration_id),
    uniqueIndex("credential_one_active")
      .on(table.workspaceId, table.integration_id)
      .where(sql`${table.active} = true and ${table.userID} is null and ${table.purpose} = 'connection'`),
    uniqueIndex("credential_member_active")
      .on(table.workspaceId, table.integration_id, table.userID)
      .where(sql`${table.active} = true and ${table.userID} is not null and ${table.purpose} = 'connection'`),
    uniqueIndex("credential_client")
      .on(table.workspaceId, table.integration_id, table.method_id)
      .where(sql`${table.purpose} = 'client'`),
  ],
)
