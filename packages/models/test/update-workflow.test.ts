import { createHash } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { sync } from "../src/sync.js"

const directory = path.resolve(".tmp/update-workflow-test")
const additionPath = path.join(directory, "addition.json")
const arbitraryPath = path.join(directory, "arbitrary.json")
const removalPath = path.join(directory, "removal.json")
let additionDigest = ""

beforeAll(async () => {
  const json = async (file: string) => JSON.parse(await readFile(file, "utf8"))
  const pin = await json("source/models-dev/pin.json")
  const body = await json(`source/models-dev/cache/body.${pin.bodyDigest}.json`)
  const addition = structuredClone(body)
  addition.openai.models["gpt-review-fixture"] = {
    ...addition.openai.models["gpt-5"],
    id: "gpt-review-fixture",
  }
  const arbitrary = structuredClone(body)
  arbitrary.openai.models["unknown-review-fixture"] = {
    ...arbitrary.openai.models["gpt-5"],
    id: "unknown-review-fixture",
    family: "unknown",
  }
  const removal = structuredClone(body)
  delete removal.openai.models["gpt-5"]
  await mkdir(directory, { recursive: true })
  const additionBytes = JSON.stringify(addition)
  additionDigest = createHash("sha256").update(additionBytes).digest("hex")
  await Promise.all([
    writeFile(additionPath, additionBytes),
    writeFile(arbitraryPath, JSON.stringify(arbitrary)),
    writeFile(removalPath, JSON.stringify(removal)),
  ])
})

afterAll(() => rm(directory, { recursive: true, force: true }))

describe("pin update review", () => {
  it("parses additions before requiring the exact source approval", async () => {
    await expect(
      sync({
        source: "path",
        path: additionPath,
        icons: false,
        updatePin: true,
        dryRun: false,
        check: false,
      }),
    ).resolves.toBeUndefined()
    await expect(
      sync({
        source: "path",
        path: additionPath,
        icons: false,
        updatePin: true,
        approveBody: additionDigest,
        observedOn: "2026-09-01",
        dryRun: true,
        check: false,
      }),
    ).resolves.toBeUndefined()
  })

  it("accepts arbitrary additions and rejects undisposed removals", async () => {
    await expect(
      sync({
        source: "path",
        path: arbitraryPath,
        icons: false,
        updatePin: true,
        dryRun: false,
        check: false,
      }),
    ).resolves.toBeUndefined()
    await expect(
      sync({
        source: "path",
        path: removalPath,
        icons: false,
        updatePin: true,
        dryRun: false,
        check: false,
      }),
    ).rejects.toThrow("removed models require a legacy disposition")
  })
})
