import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { recoverArtifactGraph, writeArtifactGraph } from "../src/sync.js"

const fixture = path.resolve(".tmp/artifact-write-test")

afterEach(async () => {
  await recoverArtifactGraph()
  await rm(fixture, { recursive: true, force: true })
})

describe("artifact graph recovery", () => {
  it("keeps untouched originals and recovers replaced files after interruption", async () => {
    await recoverArtifactGraph()
    await mkdir(fixture, { recursive: true })
    const first = path.join(fixture, "first.txt")
    const second = path.join(fixture, "second.txt")
    await writeFile(first, "old-first")
    await writeFile(second, "old-second")

    await expect(
      writeArtifactGraph(
        new Map([
          [first, "new-first"],
          [second, "new-second"],
        ]),
        [],
        (count) => {
          if (count === 1) throw new Error("simulated interruption")
        },
      ),
    ).rejects.toThrow("simulated interruption")

    expect(await readFile(second, "utf8")).toBe("old-second")
    await recoverArtifactGraph()
    expect(await readFile(first, "utf8")).toBe("old-first")
    expect(await readFile(second, "utf8")).toBe("old-second")
  })
})
