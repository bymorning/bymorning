import { Audit } from "@bymorning/core/audit"
import { Account } from "@bymorning/schema/account"
import { describe, expect, it } from "vitest"

const accountID = Account.ID.make("acc_00000000000000000000000000")

const entry = (
  sequence: number,
  previous: string | null,
  overrides: Partial<Parameters<typeof Audit.digest>[1]> = {},
) => {
  const fields = {
    id: `aud_${sequence.toString().padStart(8, "0")}x`,
    occurredAt: new Date(1_800_000_000_000 + sequence * 1000).toISOString(),
    actor: { type: "account", accountID },
    action: "auth.login",
    workspaceID: null,
    target: null,
    detail: null,
    outcome: "success",
    context: null,
    ...overrides,
  } as const
  return { ...fields, sequence, chain: Audit.digest(previous, fields) }
}

describe("Audit chain", () => {
  it("verifies an intact chain from genesis", () => {
    const first = entry(1, null)
    const second = entry(2, first.chain)
    const third = entry(3, second.chain)
    expect(Audit.verifyChain([first, second, third])).toBeUndefined()
  })

  it("detects tampered content", () => {
    const first = entry(1, null)
    const second = entry(2, first.chain)
    const tampered = { ...second, action: "auth.logout" as const }
    expect(Audit.verifyChain([first, tampered])).toBe(2)
  })

  it("detects a rewritten chain pointer", () => {
    const first = entry(1, null)
    const second = entry(2, first.chain)
    const forged = { ...second, chain: second.chain.replace(/^../, "ff") }
    expect(Audit.verifyChain([first, forged])).toBe(2)
  })

  it("detects a dropped middle Entry", () => {
    const first = entry(1, null)
    const second = entry(2, first.chain)
    const third = entry(3, second.chain)
    expect(Audit.verifyChain([first, third])).toBe(3)
  })

  it("is insensitive to object key order and normalizes absent optional fields to null", () => {
    const fields = {
      id: "aud_00000001x",
      occurredAt: "2027-01-01T00:00:00.000Z",
      actor: { type: "account", accountID },
      action: "setup.complete",
      workspaceID: null,
      target: "idp_123",
      detail: { b: 2, a: 1, nested: { z: [1, 2] } },
      outcome: "success",
      context: null,
    } as const
    const reordered = {
      context: null,
      outcome: "success",
      detail: { nested: { z: [1, 2] }, a: 1, b: 2 },
      target: "idp_123",
      workspaceID: null,
      action: "setup.complete",
      actor: { accountID, type: "account" },
      occurredAt: "2027-01-01T00:00:00.000Z",
      id: "aud_00000001x",
    } as const
    expect(Audit.digest(null, reordered)).toBe(Audit.digest(null, fields))
    // An Entry read back omits keys whose stored value was null; it digests identically.
    const { workspaceID: _w, context: _c, ...sparse } = fields
    expect(Audit.digest(null, sparse)).toBe(Audit.digest(null, fields))
  })
})
