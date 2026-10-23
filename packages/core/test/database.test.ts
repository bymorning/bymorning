import { Database } from "@bymorning/core/database"
import { ConfigProvider, Effect, Layer } from "effect"
import { expect, test } from "vitest"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { parse as parseConnectionString } from "pg-connection-string"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

test.each(["https://user:password@example.com/database", "postgresql://user:password@example.com"])(
  "rejects an invalid PostgreSQL DATABASE_URL without exposing it",
  async (url) => {
    const configProvider = ConfigProvider.fromUnknown({ DATABASE_URL: url })

    const error = await Effect.runPromise(
      Layer.build(LayerNode.compile(Database.configured)).pipe(
        Effect.scoped,
        Effect.provide(ConfigProvider.layer(configProvider)),
        Effect.flip,
      ),
    )

    expect(error._tag).toBe("ConfigError")
    expect(String(error)).not.toContain(url)
    expect(String(error)).not.toContain("password")
  },
)

test("rejects non-positive database connection limits", async () => {
  const configProvider = ConfigProvider.fromUnknown({
    DATABASE_URL: "postgresql://user:password@example.test/database",
    DATABASE_MAX_CONNECTIONS: "0",
  })

  const error = await Effect.runPromise(
    Layer.build(LayerNode.compile(Database.configured)).pipe(
      Effect.scoped,
      Effect.provide(ConfigProvider.layer(configProvider)),
      Effect.flip,
    ),
  )

  expect(error._tag).toBe("ConfigError")
  expect(String(error)).toContain("DATABASE_MAX_CONNECTIONS")
  expect(String(error)).not.toContain("password")
})

/**
 * Deployment contract: the installers ship DATABASE_URL with
 * `sslmode=verify-full&sslrootcert=/app/certs/rds-global-bundle.pem`. node-postgres
 * (through pg-connection-string) reads the CA bundle at connect time and, with
 * verify-full, leaves certificate chain and hostname verification on. A driver
 * upgrade that changes this must fail here rather than in a customer account.
 */
test("verify-full DATABASE_URL loads the CA bundle and keeps verification on", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bymorning-database-tls-"))
  try {
    const bundle = join(directory, "rds-global-bundle.pem")
    const certificate = "-----BEGIN CERTIFICATE-----\ntest-ca\n-----END CERTIFICATE-----\n"
    await writeFile(bundle, certificate)
    const url = `postgresql://gateway:secret@bymorning-prod-aurora.cluster-example.us-gov-west-1.rds.amazonaws.com:5432/bymorning?sslmode=verify-full&sslrootcert=${bundle}&statement_timeout=14000`

    const config = parseConnectionString(url)
    const ssl = typeof config.ssl === "object" ? config.ssl : {}
    expect(ssl).toMatchObject({ ca: certificate })
    expect("rejectUnauthorized" in ssl ? ssl.rejectUnauthorized : undefined).toBeUndefined()
    expect(config.statement_timeout).toBe("14000")

    // The previous installer default must visibly differ: it disables verification.
    const legacy = parseConnectionString("postgresql://gateway:secret@example.test:5432/bymorning?sslmode=no-verify")
    expect(typeof legacy.ssl === "object" && legacy.ssl.rejectUnauthorized).toBe(false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
