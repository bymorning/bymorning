import { chmod, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { parseGenerateResult, runCheck } from "../script/db-check.js"

const fakeGenerate = async (output: object) => {
  const directory = await mkdtemp(join(tmpdir(), "core-db-check-"))
  const command = join(directory, "drizzle-generate")
  await writeFile(command, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(output)}'\n`)
  await chmod(command, 0o755)
  return command
}

describe("database migration check", () => {
  it("accepts Drizzle's no-changes result", async () => {
    const command = await fakeGenerate({ status: "no_changes", dialect: "postgresql" })

    await expect(runCheck([command])).resolves.toBeUndefined()
  })

  it("rejects planned changes even when Drizzle exits successfully", async () => {
    const command = await fakeGenerate({ status: "ok", statements: [{ type: "create_table" }] })

    await expect(runCheck([command])).rejects.toThrow(
      "Database schema changes are not represented by the latest migration (1 statement(s))",
    )
  })

  it("rejects statements regardless of the reported status", async () => {
    const command = await fakeGenerate({ status: "no_changes", statements: [{ type: "alter_table" }] })

    await expect(runCheck([command])).rejects.toThrow("(1 statement(s))")
  })

  it("rejects malformed generate output", () => {
    expect(() => parseGenerateResult("[]")).toThrow("Drizzle generate returned an invalid JSON result")
  })
})
