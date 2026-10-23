import { describe, expect, it } from "vitest"
import { readFile } from "node:fs/promises"

import { ssl } from "../drizzle-ssl.js"

const configPath = new URL("../drizzle.config.ts", import.meta.url)

describe("PostgreSQL migration configuration", () => {
  it("uses plaintext connections for local SST development", () => {
    expect(ssl("localhost")).toBe(false)
    expect(ssl("127.0.0.1")).toBe(false)
  })

  it("uses TLS for deployed database hosts", () => {
    expect(ssl("database.example.com")).toEqual({ rejectUnauthorized: false })
  })

  it("inventories only the canonical Core schema", async () => {
    const config = await readFile(configPath, "utf8")

    expect(config).toContain('"./src/database/schema/*.sql.ts"')
    expect(config).not.toContain("../server/")
  })
})
