import { spawn } from "node:child_process"
import { describe, expect, it } from "vitest"

function run(args: ReadonlyArray<string>) {
  return new Promise<{ code: number | null; stdout: string }>((resolve) => {
    const child = spawn("bun", ["run", "src/cli.ts", ...args], { cwd: process.cwd() })
    const chunks: Array<Buffer> = []
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk))
    child.on("close", (code) => resolve({ code, stdout: Buffer.concat(chunks).toString("utf8") }))
  })
}

describe("CLI", () => {
  it("uses exit 2 for invalid syntax", async () => {
    expect((await run(["sync", "--source", "invalid"])).code).toBe(2)
  })

  it("supports the Fireworks target", async () => {
    expect((await run(["sync", "--source", "cache", "--provider", "fireworks", "--dry-run"])).code).toBe(0)
  })
})
