import { Database } from "@bymorning/core/database"
import { makeGlobalNode } from "@bymorning/util/effect/app-node"
import { PgClient } from "@effect/sql-pg"
import { Redacted } from "effect"
import type { ConnectionOptions } from "node:tls"

/**
 * TLS setting for the PostgreSQL driver. A CA certificate (PEM) turns TLS on
 * and verifies the server certificate against it; `false` disables TLS (PGlite
 * sockets); undefined leaves the driver defaults (URL parameters and PG* environment).
 */
export const ssl = (input: {
  readonly ssl?: boolean
  readonly ca?: Redacted.Redacted<string>
}): { readonly ssl?: boolean | ConnectionOptions } => {
  if (input.ca !== undefined) return { ssl: { ca: Redacted.value(input.ca) } }
  return input.ssl === undefined ? {} : { ssl: input.ssl }
}

export const node = (config: {
  readonly url: Redacted.Redacted<string>
  readonly maxConnections?: number
  readonly ssl?: boolean
  /** PEM CA certificate verifying the server, from the host's DATABASE_CA. */
  readonly ca?: Redacted.Redacted<string>
}) => {
  const url = new URL(Redacted.value(config.url))
  url.searchParams.set("statement_timeout", "14000")
  const client = makeGlobalNode({
    service: PgClient.PgClient,
    layer: PgClient.layer({
      url: Redacted.make(url.href),
      maxConnections: config.maxConnections ?? 10,
      connectTimeout: "5 seconds",
      idleTimeout: "30 seconds",
      ...ssl(config),
    }),
    deps: [],
  })
  return makeGlobalNode({ service: Database.Service, layer: Database.layer, deps: [client] })
}
export * as Postgres from "./database-postgres.js"
