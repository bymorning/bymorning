import { AuthProvider } from "@bymorning/schema/auth-provider"
import { sql } from "drizzle-orm"
import { check, integer, jsonb, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core"
import { timestamps } from "./timestamps.js"

/** Installation-owned OIDC login targets. */
export const AuthProviderTable = pgTable(
  "auth_provider",
  {
    id: varchar("id", { length: 30 }).$type<AuthProvider.ID>().primaryKey(),
    revision: integer().$type<AuthProvider.Revision>().notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    kind: text().$type<AuthProvider.Kind>().notNull(),
    issuer: text().$type<AuthProvider.Issuer>().notNull(),
    client_id: text().notNull(),
    client_secret: text().notNull(),
    domains: jsonb("domains").$type<ReadonlyArray<AuthProvider.Domain>>().notNull(),
    status: text().$type<AuthProvider.Status>().notNull(),
    ...timestamps,
  },
  (table) => [
    check("auth_provider_kind_check", sql`${table.kind} in ('google', 'okta', 'microsoft', 'auth0', 'ping', 'custom')`),
    check("auth_provider_status_check", sql`${table.status} in ('enabled', 'disabled')`),
    check("auth_provider_revision_check", sql`${table.revision} > 0`),
  ],
)

/** Singleton setup-token row for first Auth Provider registration and recovery. */
export const InstallationSetupTable = pgTable(
  "installation_setup",
  {
    id: text().primaryKey(),
    token: text().notNull(),
    ...timestamps,
  },
  (table) => [
    check("installation_setup_singleton", sql`${table.id} = 'installation'`),
    uniqueIndex("installation_setup_id_unique").on(table.id),
  ],
)
