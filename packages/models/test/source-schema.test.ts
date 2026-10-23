import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import { decodeProvider, decodeSourceBody, decodeSourcePin } from "../src/source-schema.js"

const readJson = async (file: string) => JSON.parse(await readFile(file, "utf8"))

describe("resolved source schema", () => {
  it("decodes the complete pinned catalog", async () => {
    const pin = decodeSourcePin(await readJson("source/models-dev/pin.json"))
    const decoded = decodeSourceBody(await readFile(`source/models-dev/cache/body.${pin.bodyDigest}.json`, "utf8"))
    expect(Object.keys(decoded)).toHaveLength(212)
    expect(Object.values(decoded).reduce((count, provider) => count + Object.keys(provider.models).length, 0)).toBe(
      7_495,
    )
  })

  it("rejects unknown fields with their path", async () => {
    const pin = decodeSourcePin(await readJson("source/models-dev/pin.json"))
    const provider = await readJson(`source/models-dev/cache/providers/openai.${pin.providers[0]!.digest}.json`)
    provider.models["gpt-5"].unexpected = true
    expect(() => decodeProvider(provider)).toThrow(/models.*gpt-5.*unexpected/s)
  })

  it("rejects invalid numeric and date fields", async () => {
    const pin = decodeSourcePin(await readJson("source/models-dev/pin.json"))
    const provider = await readJson(`source/models-dev/cache/providers/anthropic.${pin.providers[1]!.digest}.json`)
    provider.models["claude-sonnet-5"].limit.context = -1
    provider.models["claude-sonnet-5"].release_date = "yesterday"
    expect(() => decodeProvider(provider)).toThrow(/release_date.*limit.*context/s)
  })
})
