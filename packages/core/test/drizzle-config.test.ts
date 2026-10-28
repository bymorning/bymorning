import { describe, expect, it } from "vitest"

import { ssl } from "../drizzle-ssl.js"

describe("PostgreSQL migration configuration", () => {
  it("uses plaintext connections for local SST development", () => {
    expect(ssl("localhost")).toBe(false)
    expect(ssl("127.0.0.1")).toBe(false)
  })

  it("uses TLS for deployed database hosts", () => {
    expect(ssl("database.example.com")).toEqual({ rejectUnauthorized: false })
  })
})
