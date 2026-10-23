import { Redacted } from "effect"
import { describe, expect, it } from "vitest"
import { Postgres } from "./database-postgres.js"

const pem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n"

describe("Postgres.ssl", () => {
  it("maps a CA certificate to a verifying TLS object", () => {
    expect(Postgres.ssl({ ca: Redacted.make(pem) })).toEqual({ ssl: { ca: pem } })
    // The CA wins over a boolean ssl setting.
    expect(Postgres.ssl({ ssl: false, ca: Redacted.make(pem) })).toEqual({ ssl: { ca: pem } })
  })

  it("keeps the boolean and default forms unchanged", () => {
    expect(Postgres.ssl({ ssl: false })).toEqual({ ssl: false })
    expect(Postgres.ssl({ ssl: true })).toEqual({ ssl: true })
    expect(Postgres.ssl({})).toEqual({})
  })
})
