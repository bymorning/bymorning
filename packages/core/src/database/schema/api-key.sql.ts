import { ApiKey } from "@bymorning/schema/api-key"
import { ServiceAccount } from "@bymorning/schema/service-account"
import { Workspace } from "@bymorning/schema/workspace"
import { foreignKey, index, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core"
import { ServiceAccountTable } from "./service-account.sql.js"
import { timestamps, utc } from "./timestamps.js"
import { WorkspaceTable } from "./workspace.sql.js"

export const ApiKeyTable = pgTable(
  "api_key",
  {
    id: varchar("id", { length: 30 }).$type<ApiKey.ID>().primaryKey(),
    workspaceID: varchar("workspace_id", { length: 30 }).$type<Workspace.ID>().notNull(),
    serviceAccountID: varchar("service_account_id", { length: 30 }).$type<ServiceAccount.ID>().notNull(),
    name: text().notNull(),
    prefix: text().notNull(),
    hash: text().notNull(),
    timeExpires: utc("time_expires"),
    timeUsed: utc("time_used"),
    timeRevoked: utc("time_revoked"),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceID],
      foreignColumns: [WorkspaceTable.id],
      name: "api_key_workspace_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceID, table.serviceAccountID],
      foreignColumns: [ServiceAccountTable.workspaceID, ServiceAccountTable.id],
      name: "api_key_service_account_fk",
    }).onDelete("cascade"),
    uniqueIndex("api_key_hash_unique").on(table.hash),
    index("api_key_workspace_service_account_idx").on(table.workspaceID, table.serviceAccountID),
  ],
)
