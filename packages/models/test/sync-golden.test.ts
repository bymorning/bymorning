import { describe, expect, it } from "vitest"
import { canonical, sync } from "../src/sync.js"

describe("offline generation", () => {
  it("is deterministic regardless of object insertion order", () => {
    expect(canonical({ z: 1, a: { y: 2, x: 3 } })).toBe(canonical({ a: { x: 3, y: 2 }, z: 1 }))
  })

  it("checks the committed graph without network", async () => {
    await expect(
      sync({ source: "cache", icons: false, updatePin: false, dryRun: false, check: true }),
    ).resolves.toBeUndefined()
  })

  it("checks independently owned partial targets", async () => {
    await expect(
      sync({
        source: "cache",
        provider: "openai",
        icons: false,
        updatePin: false,
        dryRun: false,
        check: true,
      }),
    ).resolves.toBeUndefined()
    await expect(
      sync({ source: "cache", icons: true, updatePin: false, dryRun: false, check: true }),
    ).resolves.toBeUndefined()
  })

  it("generates every source row without quarantine", async () => {
    const openai = JSON.parse(await readFile("generated/reports/openai.json", "utf8"))
    const anthropic = JSON.parse(await readFile("generated/reports/anthropic.json", "utf8"))
    const bedrock = JSON.parse(await readFile("generated/reports/amazon-bedrock.json", "utf8"))
    expect(openai.generated).toBe(openai.sourceCandidates)
    expect(anthropic.generated).toBe(anthropic.sourceCandidates)
    expect(bedrock.generated).toBe(bedrock.sourceCandidates)
    expect(bedrock.rows.filter((row: { transport?: string }) => row.transport === "mantle-responses")).toHaveLength(9)
  })
})
import { readFile } from "node:fs/promises"
